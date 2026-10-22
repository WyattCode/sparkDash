import { displayName } from '../../displayName';
import type { SparkSnapshot } from '../../api/types';
import { resolveSparkRole } from '../../api/sparkRole';
import { finite, type Operations } from './operationsModel';
import { CockpitTrend } from './CockpitTrend';
import { ArrowUpRight } from 'lucide-react';
import { openWorkspace, workspaceHref } from '../../hooks/useWorkspaceRoute';

export function heroLatency(data: Operations | null, head: SparkSnapshot | undefined, index: number, now: number): string {
  const model = head?.metrics.llm[index];
  if (!head || !model || !data || data.windowMinutes !== 30 || data.targetError || data.backend && data.backend !== model.backend || now < data.generatedAt || now - data.generatedAt > 45_000) return '—';
  const port = head.llmPorts?.[index] ?? head.llmPort;
  const targets = data.targets.filter(t => t.labels.node === head.name && t.labels.job === 'vllm' && t.labels.instance.endsWith(':' + port));
  const target = targets.length === 1 ? targets[0] : null;
  if (!target || target.health !== 'up' || !Number.isFinite(Date.parse(target.lastScrape)) || now < Date.parse(target.lastScrape) || now - Date.parse(target.lastScrape) > 45_000) return '—';
  const read = (key: string) => {
    const section = data.metrics[key];
    if (section?.error) return null;
    const rows = section?.series.filter(s => s.labels.node === head.name && s.labels.instance === target.labels.instance && s.labels.model_name === model.modelId) ?? [];
    if (rows.length !== 1) return null;
    const point = rows[0].points.at(-1);
    return point && now >= point[0] && now - point[0] < 45_000 ? finite(point[1]) : null;
  };
  const samples = read('ttftSamples'), value = read('ttft');
  if (samples === 0) return '暂无样本';
  return samples == null || samples < 0 || value == null || value < 0 ? '—' : value.toFixed(2) + ' s';
}

export function SparkHero({ sparks, stale, onSelect, operations = null, compact = false }: { sparks: SparkSnapshot[]; stale: boolean; onSelect?: (id: string) => void; operations?: Operations | null; compact?: boolean }) {
  const head = sparks.find(s => resolveSparkRole(s) === 'head') ?? sparks.find(s => resolveSparkRole(s) === 'standalone' && s.llmMonitoring !== false);
  const index = head?.metrics.llm?.findIndex(m => m.available) ?? -1;
  const model = index >= 0 ? head?.metrics.llm[index] : undefined;
  const ready = !stale && !!head?.online && !!model;
  const count = (n: unknown) => ready && typeof n === 'number' && Number.isFinite(n) && n >= 0 ? String(Math.round(n)) : '—';
  const value = ready && finite(model?.generationTps) != null && model!.generationTps >= 0 ? model!.generationTps.toLocaleString('zh-CN', { maximumFractionDigits: 1 }) : '—';
  const context = model?.contextLength;
  const validContext = ready && typeof context === 'number' && Number.isSafeInteger(context) && context > 0;
  const contextLabel = validContext ? context >= 1048576 ? (context / 1048576).toLocaleString('zh-CN', { maximumFractionDigits: 1 }) + 'M' : context >= 1024 ? (context / 1024).toLocaleString('zh-CN', { maximumFractionDigits: 1 }) + 'K' : String(context) : '—';
  const backend = model?.backend === 'sglang' ? 'SGLang' : model?.backend === 'vllm' ? 'vLLM' : model?.backend === 'tensorfold' ? 'TensorFold' : model?.backend || '引擎未识别';
  const parallel = model?.parallelism;
  const tp = Number.isSafeInteger(parallel?.tensor) && parallel!.tensor! > 0 ? parallel!.tensor : null;
  const ep = Number.isSafeInteger(parallel?.expert) && parallel!.expert! > 0 ? parallel!.expert : null;
  const latency = ready ? heroLatency(operations, head, index, Date.now()) : '—';
  const nodes = head ? [head, ...sparks.filter(s => resolveSparkRole(s) === 'worker' && s.workerHeadId === head.id)] : [];
  const navigate = (event: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    if (onSelect && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onSelect(id); }
  };
  return <section className={`dgx-hero cockpit-hero${compact?' cockpit-hero--compact':''}`} aria-label="DGX Spark 集群概览">
    <div className="cockpit-identity">
      <div className="cockpit-identity-heading"><div className="cockpit-eyebrow">NVIDIA DGX SPARK</div>
      </div>
      <h2>{model?.modelId || '暂无可用模型'}</h2>
      <p className="cockpit-model-meta"><span>{backend}</span><span>{tp != null || ep != null ? `TP${tp ?? '—'} / EP${ep ?? '—'}` : '并行配置 —'}</span><span title={validContext ? context.toLocaleString('zh-CN') + ' tokens' : '未获取有效上下文容量'}>{contextLabel} 上下文</span></p>
      {head && <a className="cockpit-service-link" href={workspaceHref('service')} onClick={e => { if(e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) { e.preventDefault(); openWorkspace('service'); } }}>服务详情 <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" /></a>}
      <div className="cockpit-service-row"><p className="cockpit-model-status" data-ready={ready}>{stale ? '数据已过期 · 等待新鲜数据' : ready ? (!compact ? (nodes.length === 4 ? '四机协同 · ' : nodes.length > 1 ? nodes.length + ' 机协同 · ' : '') : '') + '服务可用' : '服务不可用'}</p>
      </div>
      {compact && nodes.length===4 && <div className="dgx-hero__silhouette cockpit-device-art" aria-hidden="true"><i/><i/><i/><i/></div>}
      {!compact && !!nodes.length && <ol className="cockpit-topology" aria-label="模型节点分工">{nodes.map(node => <li key={node.id} data-online={!stale && node.online}>
        <span className="cockpit-topology__point" aria-hidden="true" />
        <a href={'/spark/' + encodeURIComponent(node.id)} onClick={e => navigate(e, node.id)} title={displayName(node.name) + ' · ' + (stale ? '数据已过期' : node.online ? '在线' : '离线')}>{displayName(node.name)}</a>
        <small>{resolveSparkRole(node) === 'head' ? '主节点' : resolveSparkRole(node) === 'worker' ? '工作节点' : '独立节点'}</small>
      </li>)}</ol>}
    </div>
    <div className="cockpit-performance">
      <div className="dgx-hero__metrics cockpit-kpis">
        <div><span>输出吞吐</span><strong>{value}<em> tok/s</em></strong><small>当前采样</small></div>
        <div><span>首字延迟 P95</span><strong className="cockpit-latency">{latency.endsWith(' s') ? <>{latency.slice(0,-2)}<em> s</em></> : latency}</strong><small>近 30 分钟</small></div>
        <div><span>运行请求</span><strong>{count(model?.requestsRunning)}<em> 个</em></strong><small className="cockpit-kpi-explanation">请求数 · 非人数</small></div>
        <div><span>排队请求</span><strong>{count(model?.requestsWaiting)}<em> 个</em></strong><small className="cockpit-kpi-explanation">等待处理</small></div>
      </div>
      <CockpitTrend compact={compact} sparkId={head?.id ?? ''} port={head?.llmPorts?.[index] ?? head?.llmPort ?? index} stale={!ready} />
    </div>
  </section>;
}
