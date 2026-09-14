// Read-only, bounded Prometheus queries. No arbitrary URL/PromQL from clients.
import fs from 'node:fs';
const BASE = process.env.SPARKDASH_PROMETHEUS_URL || 'http://127.0.0.1:9090';
const group = 'node,instance,model_name';
const httpFilter = 'job="vllm",handler=~"/v1/(chat/)?completions",method="POST"';
export const QUERIES = {
  up: 'up',
  age: 'time() - timestamp(up)',
  output: `sum by (${group})(rate(vllm:generation_tokens_total[5m]))`,
  prefill: `sum by (${group})(rate(vllm:prompt_tokens_total[5m]))`,
  running: `sum by (${group})(vllm:num_requests_running)`,
  waiting: `sum by (${group})(vllm:num_requests_waiting)`,
  httpTotal: `sum by (node,instance)(increase(http_requests_total{${httpFilter}}[30m]))`,
  httpOk: `sum by (node,instance)(increase(http_requests_total{${httpFilter},status=~"2.."}[30m]))`,
  httpErrors: `sum by (node,instance,status)(increase(http_requests_total{${httpFilter},status=~"[45].."}[30m]))`,
  finished: `sum by (${group},finished_reason)(increase(vllm:request_success_total[30m]))`,
  cache: `sum by (${group})(rate(vllm:prefix_cache_hits_total[30m])) / sum by (${group})(rate(vllm:prefix_cache_queries_total[30m]))`,
  power: 'DCGM_FI_DEV_POWER_USAGE',
  gpu: 'DCGM_FI_DEV_GPU_UTIL',
  temperature: 'DCGM_FI_DEV_GPU_TEMP',
  rx: 'rate(node_network_receive_bytes_total{device!~"lo|veth.*|docker.*|br-.*"}[5m])',
  tx: 'rate(node_network_transmit_bytes_total{device!~"lo|veth.*|docker.*|br-.*"}[5m])',
  networkErrors: 'rate(node_network_receive_errs_total{device!~"lo|veth.*|docker.*|br-.*"}[5m]) + rate(node_network_transmit_errs_total{device!~"lo|veth.*|docker.*|br-.*"}[5m])',
  networkDrops: 'rate(node_network_receive_drop_total{device!~"lo|veth.*|docker.*|br-.*"}[5m]) + rate(node_network_transmit_drop_total{device!~"lo|veth.*|docker.*|br-.*"}[5m])',
};
for (const [key, name] of Object.entries({ttft: 'time_to_first_token', itl: 'inter_token_latency', e2e: 'e2e_request_latency', queue: 'request_queue_time'})) {
  const metric = `vllm:${name}_seconds`;
  QUERIES[key] = `histogram_quantile(0.95, sum by (${group},le)(rate(${metric}_bucket[30m])))`;
  QUERIES[`${key}Samples`] = `sum by (${group})(increase(${metric}_count[30m]))`;
}

export function normalizeSeries(result) {
  return (result || []).map(row => ({
    labels: row.metric,
    points: (row.values || (row.value ? [row.value] : [])).map(([at, value]) =>
      [Number(at) * 1000, Number.isFinite(Number(value)) ? Number(value) : null]),
  }));
}

async function request(path, params = {}) {
  const url = new URL(`/api/v1/${path}`, BASE);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const res = await fetch(url, {signal: AbortSignal.timeout(6000)});
  if (!res.ok) throw new Error(`Prometheus HTTP ${res.status}`);
  const body = await res.json();
  if (body.status !== 'success') throw new Error('Prometheus 查询失败');
  return body.data;
}

export function registerOperationsRoutes(app, snapshots = () => [], eventFile = null) {
  let cached = null, pending = null;
  const states = new Map();
  const events = [];
  let eventStorageError = null;
  if (eventFile) {
    try {
      const saved = JSON.parse(fs.readFileSync(eventFile, 'utf8'));
      if (Array.isArray(saved.events)) events.push(...saved.events.filter(e => Number.isFinite(e.at) && typeof e.node === 'string' && typeof e.message === 'string').slice(0,100));
    } catch (e) { if (e.code !== 'ENOENT') eventStorageError = '历史事件读取失败，现有文件未覆盖'; }
  }
  const startedAt = Date.now();
  async function load() {
    const previousEvents = JSON.stringify(events);
    const generatedAt = Date.now();
    const entries = await Promise.all(Object.entries(QUERIES).map(async ([key, query]) => {
      try { return [key, {series: normalizeSeries((await request('query', {query})).result), error: null}]; }
      catch { return [key, {series: [], error: '采集不可用'}]; }
    }));
    let targets = [], targetError = null;
    try {
      const data = await request('targets', {state: 'active'});
      targets = data.activeTargets.map(t => ({labels: t.labels, health: t.health, lastScrape: t.lastScrape}));
      for (const t of targets) {
        const key = `${t.labels.job}/${t.labels.instance}`;
        const previous = states.get(key);
        if (previous !== t.health) events.unshift({at: generatedAt, node: t.labels.node || t.labels.instance, message: `${t.labels.job}：${previous === undefined ? '首次观察' : '状态变化'} → ${t.health === 'up' ? '抓取正常' : '抓取失败'}`});
        states.set(key, t.health);
      }
      const active = new Set(targets.map(t => `${t.labels.job}/${t.labels.instance}`));
      for (const [key, state] of states) if (!key.startsWith('node:') && !active.has(key) && state !== 'missing') {
        states.set(key, 'missing'); events.unshift({at: generatedAt, node: key, message: '采集目标从配置中消失'});
      }
      events.splice(100);
    } catch { targetError = '无法获取采集目标'; }
    for (const s of snapshots()) {
      const gpuAt = s.telemetry?.updatedAt?.gpu;
      const state = !s.online ? '节点离线' : !s.telemetry?.successful?.gpu || !gpuAt || generatedAt - gpuAt > 30000 ? 'GPU 采集异常' : s.metrics.gpu?.throttle?.thermal ? 'GPU 热降频' : s.role !== 'worker' && !s.workerNode && s.llmMonitoring !== false && !s.metrics.llm.some(l => l.available) ? '模型 API 探测异常' : '已检查项目正常';
      const key = `node:${s.id}`;
      if (states.get(key) !== state) {events.unshift({at: generatedAt, node: s.name, message: `${states.has(key) ? '节点状态变化' : '首次观察'}：${state}`});states.set(key,state);}
    }
    events.splice(100);
    if (eventFile && !eventStorageError && JSON.stringify(events) !== previousEvents) {
      try {
        fs.writeFileSync(`${eventFile}.tmp`, JSON.stringify({events}), {mode: 0o600});
        fs.renameSync(`${eventFile}.tmp`, eventFile);
      } catch { eventStorageError = '事件写入失败，当前仅保留内存记录'; }
    }
    cached = {generatedAt, startedAt, windowMinutes: 30, metrics: Object.fromEntries(entries), targets, targetError, eventStorageError, events: [...events]};
    return cached;
  }
  app.get('/api/operations', async (_req, res) => {
    if (cached && Date.now() - cached.generatedAt < 15000) return res.json(cached);
    pending ||= load().finally(() => { pending = null; });
    res.json(await pending);
  });
  const historyCache = new Map();
  app.get('/api/operations/history', async (req, res) => {
    const metric = String(req.query.metric || 'output');
    if (!['output', 'prefill', 'gpu', 'temperature', 'power'].includes(metric)) return res.status(400).json({error: '不支持的指标'});
    const minutes = Number(req.query.minutes || 30);
    if (![30, 60, 360].includes(minutes)) return res.status(400).json({error: '不支持的时间范围'});
    const key = `${metric}:${minutes}`;
    const old = historyCache.get(key);
    if (old && Date.now() - old.generatedAt < 30000) return res.json(old);
    try {
      const end = Math.floor(Date.now() / 1000);
      const data = await request('query_range', {query: QUERIES[metric], start: end - minutes * 60, end, step: Math.max(15, minutes * 60 / 240)});
      const payload = {generatedAt: Date.now(), series: normalizeSeries(data.result)};
      historyCache.set(key, payload); res.json(payload);
    } catch { res.status(503).json({error: '历史数据采集不可用'}); }
  });
}
