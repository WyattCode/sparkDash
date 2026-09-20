import type { SparkSnapshot } from '../../api/types';
export interface Series { labels: Record<string, string>; points: [number, number | null][] }
export interface Operations {
  generatedAt: number; startedAt: number; windowMinutes: number;
  metrics: Record<string, {series: Series[]; error: string | null}>;
  targets: {labels: Record<string, string>; health: string; lastScrape: string}[];
  targetError: string | null;
  eventStorageError?: string | null;
  events: {at: number; node: string; message: string}[];
}
export function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
export function metricValue(data: Operations | null, key: string, node: string, instance?: string): number | null {
  const rows = data?.metrics[key]?.series.filter(s => s.labels.node === node && (!instance || s.labels.instance === instance)) || [];
  // Never silently combine independent model services or average percentiles.
  if (rows.length !== 1) return null;
  return finite(rows[0].points.at(-1)?.[1]);
}
export function percent(numerator: number | null, denominator: number | null): string {
  if (denominator === 0) return '暂无请求';
  return numerator == null || denominator == null || denominator < 0 ? '未采集' : `${Math.min(100, Math.max(0, numerator / denominator * 100)).toFixed(1)}%`;
}
export function sampleHint(samples: number | null): string {
  return samples == null || !Number.isFinite(samples) || samples < 0 ? '样本计数不可用' : samples === 0 ? '窗口内暂无样本' : samples < 1 ? '不足 1 个观测样本（估算） · 样本偏少' : `约 ${Math.round(samples)} 个观测样本${samples < 20 ? ' · 样本偏少' : ''}`;
}
export function gpuReady(s: SparkSnapshot): boolean {
  const at = finite(s.telemetry?.updatedAt?.gpu);
  const fresh = s.telemetry?.successful?.gpu === true && at != null && Date.now() >= at && Date.now() - at < 30000;
  return s.online && fresh && !!s.metrics?.gpu && (finite(s.metrics.gpu.vram?.total) ?? 0) > 0;
}
export function completeSum(series: Series[]): number | null {
  if (!series.length) return null;
  const values = series.map(s => finite(s.points.at(-1)?.[1]));
  return values.some(v => v == null) ? null : values.reduce<number>((sum, v) => sum + v!, 0);
}
export function nodeIssues(s: SparkSnapshot): string[] {
  if (!s.online) return ['节点离线'];
  const issues = [];
  if (!gpuReady(s)) issues.push('GPU 指标缺失');
  if (s.metrics.gpu?.throttle?.thermal) issues.push('GPU 热降频');
  if (s.metrics.storage.some(d => !d.disabled && d.percentage >= 90)) issues.push('磁盘空间不足');
  if (s.role !== 'worker' && !s.workerNode && s.llmMonitoring !== false && !s.metrics.llm.some(l => l.available)) issues.push('模型 API 探测不可用');
  return issues;
}
