import type { SparkSnapshot } from '../../api/types';
import { resolveSparkRole } from '../../api/sparkRole';
import { displayName } from '../../displayName';
import { useTimedMetricsHistory, SPARKLINE_TAIL } from '../../hooks/metricsStore';
import { MetricBar } from '../ui/MetricBar';
import { Sparkline } from '../ui/Sparkline';
import { finite, gpuReady } from './operationsModel';
import { temperatureColor } from './temperatureColor';

const memory = (value: unknown) => {
  const n = finite(value);
  return n == null || n < 0 ? '—' : n >= 1024 ? `${(n / 1024).toFixed(1).replace(/\.0$/, '')} GB` : `${Math.round(n)} MB`;
};

export function CockpitNodeCard({ spark, headSpark, temperatureUnit, stale, onSelect }: { spark: SparkSnapshot; headSpark?: SparkSnapshot; temperatureUnit: 'celsius' | 'fahrenheit'; stale: boolean; onSelect?: (id: string) => void }) {
  const role = resolveSparkRole(spark), gpu = spark.metrics.gpu, unified = spark.metrics.unifiedMemory;
  const ready = !stale && gpuReady(spark);
  const temp = finite(gpu?.temperature), power = finite(gpu?.power?.draw);
  const used = finite(gpu?.vram?.used ?? unified?.used), total = finite(gpu?.vram?.total ?? unified?.total);
  const available = gpu?.vram?.available ?? unified?.available, usage = finite(gpu?.usage);
  const ram = spark.metrics.ram;
  const ramFree = ram && finite(ram.total) != null && finite(ram.used) != null && ram.total >= ram.used ? ram.total - ram.used : null;
  const free = finite(spark.kind === 'host' ? ramFree : available);
  const memoryTone = ready && free != null && free >= 0 ? free < 4096 ? 'text-danger' : free < 16384 ? 'text-warning' : '' : '';
  const temperature = ready && temp != null && temp > 0 ? `${Math.round(temperatureUnit === 'fahrenheit' ? temp * 9 / 5 + 32 : temp)}°${temperatureUnit === 'fahrenheit' ? 'F' : 'C'}` : '—';
  const tempSamples = useTimedMetricsHistory(spark.id, 'gpu.temp').slice(-SPARKLINE_TAIL);
  const tempHistory = tempSamples.map(s=>temperatureUnit==='fahrenheit'?s.value*9/5+32:s.value);
  const powerSamples = useTimedMetricsHistory(spark.id, 'gpu.power').slice(-SPARKLINE_TAIL);
  const powerHistory = powerSamples.map(s=>s.value);
  const root = spark.metrics.storage?.find(d => d.label === '/') ?? spark.metrics.storage?.[0];
  const roleText = role === 'head' ? '主节点' : role === 'worker' ? '工作节点' : '独立节点';
  return <article className="overview-card cockpit-node" data-node-role={role} data-unavailable={!ready}>
    <header className="cockpit-node__header">
      <div className="cockpit-node__identity"><h3><a href={`/spark/${encodeURIComponent(spark.id)}`} onClick={e => {
        if (onSelect && e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) { e.preventDefault(); onSelect(spark.id); }
      }}>{displayName(spark.name)}</a></h3>    <details className="cockpit-node__details" onKeyDown={e => { if (e.key === 'Escape') e.currentTarget.open = false; }}>
      <summary title="查看节点分工、CPU、存储与模型归属">{roleText}</summary><div className="cockpit-node__popover">
      <dl>
        <div><dt>CPU 利用率</dt><dd>{!stale && spark.online && finite(spark.metrics.cpu?.usage) != null ? `${Math.round(spark.metrics.cpu!.usage)}%` : '—'}</dd></div>
        <div><dt>CPU 温度</dt><dd>{!stale && spark.online && (spark.metrics.cpu?.temperature ?? 0) > 0 ? `${Math.round(temperatureUnit === 'fahrenheit' ? spark.metrics.cpu!.temperature * 9 / 5 + 32 : spark.metrics.cpu!.temperature)}°${temperatureUnit === 'fahrenheit' ? 'F' : 'C'}` : '—'}</dd></div>
        <div><dt>存储可用</dt><dd>{!stale && spark.online && root ? memory(root.available) : '—'}</dd></div>
        <div><dt>{role === 'worker' ? '所属模型' : '模型服务'}</dt><dd>{role === 'worker' ? spark.workerLabel?.trim() || spark.workerDerivedLabel?.trim() || '未关联模型' : spark.metrics.llm?.find(l => l.available)?.modelId || '暂无可用模型'}</dd></div>
        {role === 'worker' && <div><dt>主节点</dt><dd>{headSpark ? <a className="worker-head-link" href={`/spark/${encodeURIComponent(headSpark.id)}`} title={`查看主节点 ${displayName(headSpark.name)}${headSpark.online ? '' : '（当前离线）'}`} onClick={e => { if (onSelect && e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) { e.preventDefault(); onSelect(headSpark.id); } }}>{displayName(headSpark.name)}</a> : '未关联'}</dd></div>}
        {spark.comfyMonitoring && <div><dt>ComfyUI</dt><dd>{spark.metrics.comfy?.available ? `运行 ${spark.metrics.comfy.queueRunning ?? '—'} / 排队 ${spark.metrics.comfy.queuePending ?? '—'}` : '不可用'}</dd></div>}
      </dl>
      {role === 'worker' && <p>{headSpark ? '参与分布式推理，吞吐和延迟统一在主节点查看。' : '尚未关联可识别的主节点，吞吐和延迟在主节点查看。'}</p>}
      {gpu?.throttle?.thermal && ready && <p className="text-danger">GPU 已触发温度降频</p>}
    </div></details></div>
      <span className="cockpit-node__status" data-online={!stale && spark.online} title={stale ? '数据已过期' : spark.online ? '在线' : '离线'} aria-label={stale ? '数据已过期' : spark.online ? '在线' : '离线'} />
    </header>
    <div className="cockpit-node__body">
      <div className="cockpit-node__row cockpit-node__bar" data-metric="gpu-usage"><MetricBar label="GPU 利用率" value={ready && usage != null ? Math.max(0, usage) : 0} max={100} autoBand={false} color={gpu?.throttle?.thermal ? 'bg-danger' : 'bg-accent'} caption={ready && usage != null && usage >= 0 ? `${Math.round(usage)}%` : '—'} /></div>
      <div className="cockpit-node__row cockpit-node__bar" data-metric="gpu-memory"><MetricBar label={spark.kind === 'host' ? '显存占用' : 'GPU 内存占用（共享池）'} value={ready && used != null ? Math.max(0, used) : 0} max={total != null && total > 0 ? total : 0} color="bg-accent" autoBand={false} caption={ready ? memory(used) : '—'} /></div>
      <div className="cockpit-node__row" data-metric="gpu-temperature"><span>GPU 温度</span><div className="cockpit-node__reading">{ready && temp != null && temp > 0 && <Sparkline label="GPU 温度" unit={temperatureUnit==='fahrenheit'?'°F':'°C'} timestamps={tempSamples.map(s=>s.at)} data={tempHistory} color="var(--color-chart-primary)" motionKey={spark.id} area={false} fitRange width={82} height={20} />}<strong className={temp != null ? temperatureColor(temp, temperatureUnit).replace('bg-', 'text-') : ''}>{temperature}</strong></div></div>
      <div className="cockpit-node__row" data-metric="gpu-power"><span>GPU 功耗（非整机）</span><div className="cockpit-node__reading">{ready && power != null && power >= 0 && <Sparkline label="GPU 功耗（非整机）" unit="W" timestamps={powerSamples.map(s=>s.at)} data={powerHistory} color="var(--color-chart-primary)" motionKey={spark.id} area={false} fitRange width={82} height={20} />}<strong>{ready && power != null && power >= 0 ? `${power.toLocaleString('zh-CN', {maximumFractionDigits: 1})} W` : '—'}</strong></div></div>
      <div className="cockpit-node__row"><span>{spark.kind === 'host' ? '系统剩余内存' : '系统可用内存'}</span><strong className={memoryTone}>{ready ? memory(free) : '—'}</strong></div>
    </div>

  </article>;
}
