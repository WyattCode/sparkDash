/** Normal = node data color; warning/danger retain existing thresholds. */
export function bandColor(pct: number, base = "bg-data"): string {
  if (pct > 85) return "bg-danger";
  if (pct > 60) return "bg-warning";
  return base;
}

interface MetricBarProps {
  autoBand?: boolean;
  label: string;
  value: number;
  max: number;
  color?: string;
  caption?: string;
  /** Optional second caption line shown below the bar. */
  subCaption?: string;
}

/**
 * Horizontal progress bar. Used in the detail panels (GpuPanel) and the
 * overview cards to show usage, temperature, and allocation at a glance.
 */
export function MetricBar({
  autoBand = true,
  label,
  value,
  max,
  color = "bg-data",
  caption,
  subCaption,
}: MetricBarProps) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const barColor = autoBand ? bandColor(pct, color) : color;

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted">{label}</span>
        <span className="font-tabular text-sm text-text">{caption ?? `${pct}%`}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-border">
        <div
          className={`metric-bar-fill h-full rounded-full transition-[width] duration-300 ease-out ${barColor}`}
          style={{ ["--bar-pct" as string]: `${pct}%` }}
        />
      </div>
      {subCaption && (
        <div className="text-right text-xs text-muted">{subCaption}</div>
      )}
    </div>
  );
}
