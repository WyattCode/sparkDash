/** Exact gauges/counters must not be silently rounded into plausible counts. */
export function formatCount(value: number | null | undefined): string {
  if (value == null) return '未采集';
  if (!Number.isSafeInteger(value) || value < 0) return '数据异常';
  return String(value);
}

/** Prometheus increase() extrapolates window totals, which may be fractional. */
export function formatEstimatedCount(value: number | null | undefined): string {
  if (value == null) return '未采集';
  if (!Number.isFinite(value) || value < 0) return '数据异常';
  if (value === 0) return '0 次';
  if (value < 1) return '不足 1 次（估算）';
  return `约 ${Math.round(value)} 次`;
}
