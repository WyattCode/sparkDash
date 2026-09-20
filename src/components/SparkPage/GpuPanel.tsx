import type { CpuMetrics, GpuMetrics } from "../../api/types";
import { Sparkline } from "../ui/Sparkline";
import { Panel } from "../ui/Panel";
import { ActivityIcon } from "../ui/icons";
import { MetricBar } from "../ui/MetricBar";
import { useMetricsHistoryTail } from "../../hooks/metricsStore";
import { finite } from "../OverviewPage/operationsModel";

interface GpuPanelProps {
  gpu: GpuMetrics | null;
  /** When set and temperature > 0, show a CPU temp row (DGX Spark pages). */
  cpu?: CpuMetrics | null;
  sparkId: string;
  temperatureUnit: "celsius" | "fahrenheit";
  className?: string;
  unavailable?: boolean;
}

function celsiusToFahrenheit(c: number): number {
  return Math.round(c * 9 / 5 + 32);
}

function formatMb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

function MetricRow({
  label,
  spark,
  value,
  color = "var(--color-data)",
}: {
  label: string;
  spark: React.ReactNode;
  value: React.ReactNode;
  color?: string;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted">{label}</span>
      <div className="flex items-center gap-3">
        <span style={{ color }}>{spark}</span>
        <span className="font-tabular text-sm font-semibold text-text">{value}</span>
      </div>
    </div>
  );
}

export function GpuPanel({ gpu: inputGpu, cpu, sparkId, temperatureUnit, className, unavailable = false }: GpuPanelProps) {
  const gpu = unavailable ? null : inputGpu;
  const tempHistory = useMetricsHistoryTail(sparkId, "gpu.temp");
  const usageHistory = useMetricsHistoryTail(sparkId, "gpu.usage");
  const cpuTempHistory = useMetricsHistoryTail(sparkId, "cpu.temp");

  const temperature = finite(gpu?.temperature);
  const displayTemp = temperature == null ? null : temperatureUnit === "fahrenheit" ? celsiusToFahrenheit(temperature) : temperature;
  const tempLabel = displayTemp == null ? '未采集' : temperatureUnit === "fahrenheit" ? `${displayTemp}°F` : `${displayTemp}°C`;
  const usage = finite(gpu?.usage);
  const powerDraw = finite(gpu?.power?.draw);
  const powerLimit = finite(gpu?.power?.limit);

  const vramUsed = finite(gpu?.vram?.used);
  const vramTotal = finite(gpu?.vram?.total);

  const cpuTemperature = cpu?.temperature ?? 0;
  const cpuDisplayTemp =
    temperatureUnit === "fahrenheit" ? celsiusToFahrenheit(cpuTemperature) : cpuTemperature;
  const cpuTempLabel =
    temperatureUnit === "fahrenheit" ? `${cpuDisplayTemp}°F` : `${cpuDisplayTemp}°C`;

  const tempColor =
    temperature != null && temperature > 85
      ? "var(--color-danger)"
      : temperature != null && temperature > 65
        ? "var(--color-warning)"
        : "var(--color-data)";
  // GB10 junction bands (warn 85 / crit 95) — idle CPU sits ~70°C, so GPU 65/85 would pin amber.
  const cpuTempColor =
    cpuTemperature > 95
      ? "var(--color-danger)"
      : cpuTemperature > 85
        ? "var(--color-warning)"
        : "var(--color-data)";

  return (
    <Panel
      title="GPU"
      accent
      icon={<ActivityIcon />}
      className={`panel-gpu ${className ?? ""}`}
      bodyClassName="space-y-3"
    >
      {!gpu && <p role="status" className="text-sm text-muted">GPU 指标不可用，请检查采集状态；不代表硬件离线。</p>}
      <MetricRow
        label="使用率"
        color="var(--color-data)"
        spark={gpu && <Sparkline data={usageHistory} color="var(--color-data)" width={180} />}
        value={<span className="text-text-strong">{usage == null ? '未采集' : `${usage}%`}</span>}
      />
      <MetricRow
        label="温度"
        color={tempColor}
        spark={gpu && <Sparkline data={tempHistory} color={tempColor} width={180} />}
        value={<span className="text-text-strong">{tempLabel}</span>}
      />
      {cpuTemperature > 0 && (
        <MetricRow
          label="CPU"
          color={cpuTempColor}
          spark={<Sparkline data={cpuTempHistory} color={cpuTempColor} width={180} />}
          value={<span className="text-text-strong">{cpuTempLabel}</span>}
        />
      )}
      <div className="flex justify-between text-sm">
        <span className="text-muted">GPU 功耗</span>
        <span className="font-tabular text-sm text-text">
          {powerDraw == null ? '未采集' : `${powerDraw} W`} / {powerLimit == null ? '未采集' : `${powerLimit} W`}
        </span>
      </div>

      {/* NVIDIA throttle / thermal slowdown + SM clock headroom */}
      {(() => {
        const t = gpu?.throttle;
        const reason = t?.reason;
        const chipLabel =
          reason === "thermal"
            ? "温度限制"
            : reason === "power"
              ? "功耗限制"
              : reason === "hw"
                ? "硬件限制"
                : reason === 'ok' ? "正常" : '未采集';
        const chipClass =
          reason === "thermal"
            ? "border-danger/40 bg-danger/15 text-danger"
            : reason === "power" || reason === "hw"
              ? "border-warning/40 bg-warning/15 text-warning"
              : "border-border bg-surface-elevated text-muted";
        const barColor =
          reason === "thermal"
            ? "bg-danger"
            : reason === "power" || reason === "hw"
              ? "bg-warning"
              : "bg-data";
        const pct = t?.smClockPct;
        const clockCaption =
          t?.smClockMHz != null && t?.smClockMaxMHz != null
            ? `${t.smClockMHz} / ${t.smClockMaxMHz} MHz`
            : pct != null
              ? `${pct}%`
              : "—";
        return (
          <div className="space-y-1.5" title={t?.detail ?? undefined}>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted">降频</span>
              <span
                className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${chipClass}`}
              >
                {chipLabel}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[10px] uppercase tracking-wide text-muted">SM 时钟频率</span>
              <span className="font-tabular text-xs text-text">{clockCaption}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-border">
              <div
                className={`h-full rounded-full transition-[width] duration-300 ease-out ${barColor}`}
                style={{
                  width: `${pct != null ? Math.min(100, Math.max(0, pct)) : 0}%`,
                }}
              />
            </div>
          </div>
        );
      })()}

      {/* GPU-allocated memory (portion of the unified pool held by GPU compute apps) */}
      {gpu && (
        <div className="space-y-2 border-t border-border pt-3">
          {vramTotal != null && vramTotal > 0 && vramUsed != null ? (
            <>
              <MetricBar
                label="显存"
                value={vramUsed}
                max={vramTotal}
                caption={vramTotal > 0 ? `${formatMb(vramUsed).replace(/ (GB|MB)$/, "")} / ${formatMb(vramTotal)}` : "—"}
              />
              {finite(gpu.vram?.available) != null && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted">可用</span>
                  <span className="font-tabular text-text">{formatMb(gpu.vram.available)}</span>
                </div>
              )}
            </>
          ) : (
            <div className="flex justify-between text-xs">
              <span className="text-muted">显存</span>
              <span className="font-tabular text-text">
                {vramUsed != null ? `${formatMb(vramUsed)} 已用` : "未采集"}
              </span>
            </div>
          )}
        </div>
      )}

      {(gpu?.nvErrNoMemory ?? 0) > 0 && (
        <div
          className="flex items-center justify-between text-sm"
          title="系统日志中本次启动以来的 NV_ERR_NO_MEMORY 次数，表示 GPU 内存分配失败，不代表当前仍在报错。"
        >
          <span className="text-muted">内存分配失败 · 启动累计</span>
          <span className="font-tabular text-sm font-semibold text-muted-strong">
            {gpu?.nvErrNoMemory}
          </span>
        </div>
      )}

      {/* Top GPU processes by VRAM usage */}
      {gpu && gpu.processes && gpu.processes.length > 0 && (
        <div className="space-y-1.5 border-t border-border pt-3">
          <div className="text-[10px] uppercase tracking-wide text-muted">进程</div>
          {gpu.processes.map((proc) => (
            <div key={proc.pid} className="flex items-center justify-between gap-2 text-xs">
              <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
                <span className="min-w-0 truncate text-text" title={`${proc.name} (PID ${proc.pid})`}>
                  {proc.name}
                </span>
                <span className="shrink-0 font-tabular text-[10px] text-muted">
                  {proc.pid}
                </span>
              </div>
              <span className="shrink-0 font-tabular text-text">
                {formatMb(proc.vramMB)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
