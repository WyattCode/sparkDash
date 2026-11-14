import path from 'node:path';
import { NativeOperationsHistory } from './nativeOperationsHistory.js';
import { parseTensorfoldMetrics } from "./collectors/tensorfoldMetrics.js";
// Read-only, bounded Prometheus queries. No arbitrary URL/PromQL from clients.
import fs from 'node:fs';
const BASE = process.env.SPARKDASH_PROMETHEUS_URL || 'http://127.0.0.1:9090';
const group = 'node,instance,model_name';
// SGLang exposes request/response counters under the `endpoint` label (not
// `handler`, which only exists on http_request_duration_seconds_*), and only
// `sglang:http_responses_total` carries the `status_code` label needed for an
// HTTP success rate. Always exclude /health from the "inference" scope.
const httpScope = 'job="vllm",endpoint=~"/v1/(chat/)?completions",method="POST"';
export const QUERIES = {
  up: 'up',
  age: 'time() - timestamp(up)',
  output: `sum by (${group})(rate(sglang:generation_tokens_total[5m]))`,
  // Input throughput = tokens the GPU actually prefilled (mode="input"). The
  // older prompt_tokens_total also counts prefix-cache hits, which inflated the
  // chart by orders of magnitude during cache-heavy traffic (no GPU work).
  prefill: `sum by (${group})(rate(sglang:prefill_effective_tokens_total{mode="input"}[5m]))`,
  running: `sum by (${group})(sglang:num_running_reqs)`,
  waiting: `sum by (${group})(sglang:num_queue_reqs)`,
  httpTotal: `sum by (node,instance)(increase(sglang:http_responses_total{${httpScope}}[30m]))`,
  httpOk: `sum by (node,instance)(increase(sglang:http_responses_total{${httpScope},status_code=~"2.."}[30m]))`,
  httpErrors: `sum by (node,instance,status_code)(increase(sglang:http_responses_total{${httpScope},status_code=~"[45].."}[30m]))`,
  finished: `sum by (${group},finished_reason)(increase(sglang:num_requests_total[30m]))`,
  // Hit rate = cached / (computed + cached). The previous denominator used
  // generation_tokens_total (OUTPUT tokens), which is unrelated to prefill.
  cache: `sum by (${group})(rate(sglang:prefill_effective_tokens_total{mode=~".+_hit"}[30m])) / sum by (${group})(rate(sglang:prefill_effective_tokens_total[30m]))`,
  power: 'DCGM_FI_DEV_POWER_USAGE',
  gpu: 'DCGM_FI_DEV_GPU_UTIL',
  temperature: 'DCGM_FI_DEV_GPU_TEMP',
  rx: 'rate(node_network_receive_bytes_total{device!~"lo|veth.*|docker.*|br-.*"}[5m])',
  tx: 'rate(node_network_transmit_bytes_total{device!~"lo|veth.*|docker.*|br-.*"}[5m])',
  networkErrors: 'rate(node_network_receive_errs_total{device!~"lo|veth.*|docker.*|br-.*"}[5m]) + rate(node_network_transmit_errs_total{device!~"lo|veth.*|docker.*|br-.*"}[5m])',
  networkDrops: 'rate(node_network_receive_drop_total{device!~"lo|veth.*|docker.*|br-.*"}[5m]) + rate(node_network_transmit_drop_total{device!~"lo|veth.*|docker.*|br-.*"}[5m])',
};
for (const [key, name] of Object.entries({ttft: 'time_to_first_token', itl: 'inter_token_latency', e2e: 'e2e_request_latency', queue: 'queue_time'})) {
  const metric = `sglang:${name}_seconds`;
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

// Select by the currently observed engine, never mix stopped SGLang history
// into TensorFold's live service. Unsupported keys deliberately have no query.
export function queriesForBackend(backend) {
  if (backend !== 'tensorfold') return QUERIES;
  const q = {...QUERIES};
  const scope = '{job="vllm"}';
  const metric = name => `${name}${scope}`;
  const fresh = name => `(${metric(name)} and (time() - timestamp(${metric(name)}) < 30))`;
  const rate = name => `sum by (node,instance)(rate(${metric(name)}[5m])) and on (node,instance) ${fresh(name)}`;
  q.output = rate('tensorfold_health:completion_tokens_total');
  q.prefill = rate('tensorfold:prompt_tokens_total');
  q.running = fresh('tensorfold:requests_running');
  q.waiting = fresh('tensorfold:requests_waiting');
  for (const key of ['httpTotal','httpOk','httpErrors','finished','cache','itl','itlSamples','queue','queueSamples']) delete q[key];
  for (const [key,name] of [['ttft','time_to_first_token'],['e2e','request_latency']]) {
    const base = `tensorfold:${name}_seconds`;
    q[key] = `histogram_quantile(0.95,sum by (node,instance,le)(rate(${metric(base+'_bucket')}[30m]))) and on (node,instance) ${fresh(base+'_count')}`;
    q[key+'Samples'] = `sum by (node,instance)(increase(${metric(base+'_count')}[30m])) and on (node,instance) ${fresh(base+'_count')}`;
  }
  q.completed = `sum by (node,instance)(increase(${metric('tensorfold_health:requests_total')}[30m])) and on (node,instance) ${fresh('tensorfold_health:requests_total')}`;
  return q;
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

export function registerOperationsRoutes(app, snapshots = () => [], eventFile = null, getSpark = () => null) {
  const history = new NativeOperationsHistory(eventFile ? path.join(path.dirname(eventFile),'native-metric-history.json') : null);
  const historyTimer = eventFile ? setInterval(()=>history.record(snapshots()),5000) : null;
  historyTimer?.unref();
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
  const backend = () => snapshots().find(s => s.role === 'head')?.metrics?.llm?.find(l => l.backend)?.backend;
  async function load() {
    const previousEvents = JSON.stringify(events);
    const generatedAt = Date.now();
    const queryBackend=backend();
    const current = snapshots();
    const local = current.filter(s=>s.isLocal&&s.role!=='worker'&&s.llmMonitoring!==false&&s.metrics.llm.some(l=>l.backend==='tensorfold'));
    const nativeOnly=local.length>0&&current.filter(s=>s.role!=='worker'&&s.llmMonitoring!==false).every(s=>local.includes(s)&&s.metrics.llm.every(l=>l.backend==='tensorfold'));

    const entries = await Promise.all(Object.entries(queriesForBackend(queryBackend)).map(async ([key, query]) => {
      if(nativeOnly)return [key,{series:[],error:null}];
      try { return [key, {series: normalizeSeries((await request('query', {query})).result), error: null}]; }
      catch { return [key, {series: [], error: '采集不可用'}]; }
    }));
    let targets = [], targetError = null;
    try {
      const data = nativeOnly ? {activeTargets:[]} : await request('targets', {state:'active'});
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
    const metrics = Object.fromEntries(entries);
    for (const s of local) {
      for (const [index, llm] of s.metrics.llm.entries()) {
        if (llm.backend !== 'tensorfold') continue;
        const port = s.llmPorts?.[index] ?? s.llmPort;
        if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
        const labels = {node:s.name,instance:`127.0.0.1:${port}`,model_name:llm.modelId,job:'vllm',backend:'tensorfold',source:'native'};
        if (!llm.available) {
          targets.push({labels,health:'down',lastScrape:new Date(generatedAt).toISOString()});
          continue;
        }
        try {
          const key = getSpark(s.id)?.llmApiKeys?.[String(port)];
          const res = await fetch(`http://127.0.0.1:${port}/metrics`,{signal:AbortSignal.timeout(3000),redirect:'error',headers:key?{Authorization:`Bearer ${key}`}:{}});
          if (!res.ok) throw new Error('metrics unavailable');
          const text = await res.text();
          if (!text.includes('tensorfold:')) throw new Error('not TensorFold metrics');
          const sample = parseTensorfoldMetrics(text);
          const llmAt = s.telemetry?.updatedAt?.llm;
          if (llm.requestsWaitingFromHealth === true && typeof llmAt === 'number' && generatedAt >= llmAt && generatedAt - llmAt < 30000 &&
              Number.isInteger(llm.requestsWaiting) && llm.requestsWaiting >= 0) {
            sample.waiting = llm.requestsWaiting;
          }
          for (const [name,value] of Object.entries(sample)) {
            metrics[name] ||= {series:[],error:null};
            metrics[name].series.push({labels,points:[[generatedAt,value]]});
          }
          targets.push({labels,health:'up',lastScrape:new Date(generatedAt).toISOString()});
        } catch {
          targets.push({labels,health:'down',lastScrape:new Date(generatedAt).toISOString()});
        }
      }
    }
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
    cached = {generatedAt, startedAt, backend:queryBackend, windowMinutes: 30, aggregation:nativeOnly?'lifetime':'window', expectedTargets:nativeOnly?[]:null, metrics, targets, targetError, eventStorageError, events: [...events]};
    return cached;
  }
  app.get('/api/operations', async (_req, res) => {
    if (cached && cached.backend===backend() && Date.now() - cached.generatedAt < 15000) return res.json(cached);
    pending ||= load().finally(() => { pending = null; });
    res.json(await pending);
  });
  const historyCache = new Map();
  app.get('/api/operations/history', async (req, res) => {
    const metric = String(req.query.metric || 'output');
    if (!['output', 'prefill', 'gpu', 'temperature', 'power'].includes(metric)) return res.status(400).json({error: '不支持的指标'});
    const minutes = Number(req.query.minutes || 30);
    if (![30, 60, 360].includes(minutes)) return res.status(400).json({error: '不支持的时间范围'});
    if(backend()==='tensorfold'){history.record(snapshots());return res.json(history.query(metric,minutes));}
    const key = `${backend()}:${metric}:${minutes}`;
    const old = historyCache.get(key);
    if (old && Date.now() - old.generatedAt < 30000) return res.json(old);
    try {
      const end = Math.floor(Date.now() / 1000);
      const data = await request('query_range', {query: queriesForBackend(backend())[metric], start: end - minutes * 60, end, step: Math.max(15, minutes * 60 / 240)});
      const payload = {generatedAt: Date.now(), series: normalizeSeries(data.result)};
      historyCache.set(key, payload); res.json(payload);
    } catch { res.status(503).json({error: '历史数据采集不可用'}); }
  });
  return {close(){if(historyTimer)clearInterval(historyTimer);history.flush();}};
}
