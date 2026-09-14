import { useEffect, useState } from "react";
import type { SparkSnapshot } from "../../api/types";
import { isWorkerSpark, resolveSparkRole } from "../../api/sparkRole";
import { shutdownAllSparks, updateAllHermes, wakeAllSparks } from "../../api/client";
import { ConfirmShutdownDialog } from "../ConfirmShutdownDialog";
import { MetricBar } from "../ui/MetricBar";
import { FleetEnergyCard } from "./FleetEnergyCard";
import { FleetAlertStrip } from "./FleetAlertStrip";
import { ActivityIcon, PowerOffIcon, PowerOnIcon, RotateIcon } from "../ui/icons";
import { OperationsPanel } from './OperationsPanel';
import { finite, gpuReady, nodeIssues } from './operationsModel';
import { temperatureColor } from './temperatureColor';

interface OverviewPageProps {
  telemetryStale?: boolean;
  sparks: SparkSnapshot[];
  hideOffline?: boolean;
  hideWorkers?: boolean;
  showFleetEnergy?: boolean;
  showFleetExceptions?: boolean;
  showOverviewSearch?: boolean;
  temperatureUnit?: "celsius" | "fahrenheit";
  onSelectSpark?: (id: string) => void;
}

function celsiusToFahrenheit(c: number): number {
  return Math.round(c * 9 / 5 + 32);
}

function formatMb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

/** Format a storage value in MB, stripping trailing ".0" and optionally omitting the unit. */
function fmtStorage(mb: number, unit: boolean): string {
  const val = mb >= 1024 ? mb / 1024 : mb;
  const label = mb >= 1024 ? "GB" : "MB";
  const s = val.toFixed(1).replace(/\.0$/, "");
  return unit ? `${s} ${label}` : s;
}

function MiniStat({
  label,
  value,
  tone = "default",
  bold = true,
  title,
  wrap = false,
}: {
  label: string;
  value: string;
  tone?: "default" | "accent" | "warning" | "danger" | "success";
  bold?: boolean;
  title?: string;
  /** Allow value to wrap (no ellipsis trim) — used for long model ids. */
  wrap?: boolean;
}) {
  const toneClass =
    tone === "danger"
      ? "text-danger"
      : tone === "warning"
        ? "text-warning"
        : tone === "accent"
          ? "text-accent"
          : tone === "success"
            ? "text-success"
            : "text-text";
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[10px] tracking-wide text-muted">{label}</span>
      <span
        className={`font-tabular text-[13px] ${
          wrap
            ? "whitespace-normal break-words leading-snug [overflow-wrap:anywhere]"
            : "truncate"
        } ${bold ? "font-semibold" : ""} ${toneClass}`}
        title={title}
      >
        {value}
      </span>
    </div>
  );
}

function SparkCard({
  spark,
  headSparkName,
  temperatureUnit,
  onSelect,
}: {
  spark: SparkSnapshot;
  headSparkName?: string | null;
  temperatureUnit: "celsius" | "fahrenheit";
  onSelect?: (id: string) => void;
}) {
  const gpu = spark.metrics.gpu;
  const um = spark.metrics.unifiedMemory;
  const online = spark.online;

  const usage = gpu?.usage ?? 0;
  const tempRaw = gpu?.temperature ?? 0;
  const displayTemp = temperatureUnit === "fahrenheit" ? celsiusToFahrenheit(tempRaw) : tempRaw;
  const tempLabel = temperatureUnit === "fahrenheit" ? `${displayTemp}°F` : `${displayTemp}°C`;
  const vramPct = gpu?.vram?.percentage ?? um?.percentage ?? 0;
  const vramUsed = gpu?.vram?.used ?? um?.used ?? 0;
  const vramTotal = gpu?.vram?.total ?? um?.total ?? 0;
  const vramAvail = gpu?.vram?.available ?? um?.available ?? 0;

  // Normal data uses node identity; threshold states override it.
  const tempBarColor = temperatureColor(tempRaw, temperatureUnit);
  const usageBarColor = gpu?.throttle?.thermal ? "bg-danger" : "bg-data";
  // VRAM allocation: accent normal → warning/danger as it fills
  const vramBarColor = vramPct > 85 ? "bg-danger" : vramPct > 60 ? "bg-warning" : "bg-data";

  return (
    <div
      className="overview-card flex flex-col"
      data-node-role={spark.role}
      style={{
        padding: "var(--density-card-pad)",
        gap: "var(--density-card-gap)",
        ...(online ? {} : { opacity: 0.6 }),
      }}
    >
      {/* Card header */}
      <div className="flex items-center gap-2.5">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${online ? "bg-success dot-glow-success" : "bg-danger"}`}
        />
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-text-strong">
          {onSelect ? (
            <button
              type="button"
              onClick={() => onSelect(spark.id)}
              className="text-left font-inherit text-inherit hover:underline"
            >
              {spark.name}
            </button>
          ) : (
            spark.name
          )}
        </span>
        {(() => {
          const role = resolveSparkRole(spark);
          const text =
            role === "head" ? "主节点" : role === "worker" ? "工作节点" : "独立节点";
          const title =
            role === "head"
              ? "Cluster head Spark"
              : role === "worker"
                ? spark.workerLabel?.trim()
                  ? `${spark.workerLabel.trim()} · distributed LLM worker`
                  : "Distributed LLM worker"
                : spark.llmMonitoring === false
                  ? "Standalone — LLM monitoring off"
                  : "Standalone Spark";
          return (
            <span
              className="node-identity-tag shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
              title={title}
            >
              {text}
            </span>
          );
        })()}
        {spark.comfyMonitoring ? (
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
              !spark.metrics?.comfy?.available
                ? "bg-border/60 text-muted"
                : (spark.metrics.comfy.queueRunning ?? 0) > 0
                  ? "bg-accent/15 text-accent"
                  : (spark.metrics.comfy.queuePending ?? 0) > 0
                    ? "bg-warning/15 text-warning"
                    : "bg-border/60 text-muted"
            }`}
            title={
              !spark.metrics?.comfy?.available
                ? "ComfyUI 监控已开启 — 无法访问"
                : (spark.metrics.comfy.queueRunning ?? 0) > 0
                  ? spark.metrics.comfy.activeJob?.title
                    ? `ComfyUI running: ${spark.metrics.comfy.activeJob.title}`
                    : "ComfyUI 任务运行中"
                  : (spark.metrics.comfy.queuePending ?? 0) > 0
                    ? `ComfyUI queue: ${spark.metrics.comfy.queuePending} pending`
                    : "ComfyUI 空闲"
            }
          >
            {!spark.metrics?.comfy?.available
              ? "Comfy"
              : (spark.metrics.comfy.queueRunning ?? 0) > 0
                ? "Comfy · 运行中"
                : (spark.metrics.comfy.queuePending ?? 0) > 0
                  ? `Comfy · ${spark.metrics.comfy.queuePending}q`
                  : "Comfy · 空闲"}
          </span>
        ) : null}
        <span className="text-[10px] uppercase tracking-wide text-muted">
          {online ? "在线" : "离线"}
        </span>
      </div>

      {!online || !gpuReady(spark) ? (
        <div className="flex h-[120px] items-center justify-center">
          <span className="text-[13px] text-muted">
            {online ? "GPU 指标未就绪、过期或采集失败" : "节点不可达"}
          </span>
        </div>
      ) : (
        <>
          {/* Three headline bars: GPU alloc, Temp, Usage */}
          <div className="node-primary-metrics flex flex-col gap-3.5">
            <MetricBar
              label={spark.kind === 'host' ? '显存分配' : 'GPU 内存分配（共享池）'}
              value={vramUsed}
              max={vramTotal}
              color={vramBarColor}
              caption={vramTotal > 0 ? `${fmtStorage(vramUsed, false)} / ${fmtStorage(vramTotal, true)}` : "—"}
            />
            {spark.kind === "host" && (() => {
              // Non-Spark hosts: system RAM is separate from discrete VRAM.
              const ram = spark.metrics.ram;
              const rUsed = ram?.used ?? 0;
              const rTotal = ram?.total ?? 0;
              const rPct = rTotal > 0 ? Math.round((rUsed / rTotal) * 100) : 0;
              const ramBarColor = rPct > 85 ? "bg-danger" : rPct > 60 ? "bg-warning" : "bg-data";
              return (
                <MetricBar
                  label="内存"
                  value={rUsed}
                  max={rTotal}
                  color={ramBarColor}
                  caption={rTotal > 0 ? `${fmtStorage(rUsed, false)} / ${fmtStorage(rTotal, true)}` : "—"}
                />
              );
            })()}
            <MetricBar
              label={
                spark.kind === "host" || (spark.metrics.cpu?.temperature ?? 0) > 0
                  ? "GPU 温度"
                  : "温度"
              }
              value={displayTemp}
              autoBand={false}
              max={temperatureUnit === "fahrenheit" ? 212 : 100}
              color={tempBarColor}
              caption={tempLabel}
            />
            {(spark.metrics.cpu?.temperature ?? 0) > 0 && (() => {
              const cpuRaw = spark.metrics.cpu?.temperature ?? 0;
              const cpuDisplay =
                temperatureUnit === "fahrenheit" ? celsiusToFahrenheit(cpuRaw) : cpuRaw;
              const cpuLabel =
                temperatureUnit === "fahrenheit" ? `${cpuDisplay}°F` : `${cpuDisplay}°C`;
              const cpuBarColor =
                cpuRaw > 95 ? "bg-danger" : cpuRaw > 85 ? "bg-warning" : "bg-data";
              return (
                <MetricBar
                  label="CPU 温度"
                  value={cpuDisplay}
                  max={temperatureUnit === "fahrenheit" ? 212 : 100}
                  color={cpuBarColor}
                  caption={cpuLabel}
                />
              );
            })()}
            {gpu?.throttle?.thermal && (
              <div
                className="rounded border border-danger/40 bg-danger/10 px-2 py-1 text-[11px] font-medium text-danger"
                title={gpu.throttle.detail || "GPU 已触发温度降频"}
              >
                温度降频
              </div>
            )}
            <MetricBar
              label="GPU 使用率"
              autoBand={false}
              value={usage}
              max={100}
              color={usageBarColor}
              caption={`${usage}%`}
            />
          </div>

          {/* Secondary stats */}
          <div className="node-secondary-metrics mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-border pt-3.5">
            <MiniStat
              label="功耗"
              value={`${gpu?.power?.draw ?? 0}W / ${gpu?.power?.limit ?? 0}W`}
            />
            {(
              <MiniStat
                label={spark.kind === 'host' ? '可用内存' : '系统可用内存（共享池）'}
                value={finite(gpu?.vram?.available ?? um?.available) == null ? '未采集' : formatMb(vramAvail)}
                tone={vramAvail < 4096 ? "danger" : vramAvail < 16384 ? "warning" : "accent"}
              />
            )}
            {(() => {
              // Find the root disk by label "/" (the collector maps the host
              // root mount to that label). Fall back to the GB10 partition name
              // so the overview keeps working where labels aren't populated.
              const rootDisk =
                spark.metrics.storage.find((d) => d.label === "/") ??
                spark.metrics.storage.find((d) => d.device === "nvme0n1p2");
              if (rootDisk) {
                return (
                  <MiniStat
                    label="存储"
                    value={`${fmtStorage(rootDisk.used, false)} / ${fmtStorage(rootDisk.total, true)}`}
                    tone={rootDisk.percentage > 85 ? "danger" : rootDisk.percentage > 60 ? "warning" : "default"}
                    bold={false}
                  />
                );
              }
              return null;
            })()}
            {(() => {
              const role = resolveSparkRole(spark);

              // Workers have no local LLM API — show cluster/model label instead.
              // Priority: manual workerLabel override > derived head-model
              // mirror > generic fallback. Derived never shows a stale model:
              // the backend nulls it when the head is unresolvable/offline.
              if (role === "worker") {
                const label =
                  spark.workerLabel?.trim() || spark.workerDerivedLabel?.trim() || "distributed";
                const title = headSparkName
                  ? `${label} · worker of ${headSparkName}`
                  : `${label} · distributed LLM worker`;
                return (
                  <MiniStat
                    label="工作节点"
                    value={label}
                    tone="accent"
                    title={title}
                    wrap
                  />
                );
              }

              // Head / Standalone: same as before — live backend + model id.
              const llmArr = spark.metrics.llm;
              const llm = Array.isArray(llmArr) ? llmArr.find((l) => l.available) : null;
              if (!llm) return null;
              return (
                <MiniStat
                  label={
                    llm.backend === "vllm"
                      ? "vLLM"
                      : llm.backend === "ds4"
                        ? "ds4"
                        : llm.backend === "sglang"
                          ? "sgLang"
                          : llm.backend === "exl3"
                            ? "EXL3"
                            : llm.backend === "q27"
                              ? "q27"
                              : llm.backend ?? "LLM"
                  }
                  value={llm.modelId ?? "unknown"}
                  tone="accent"
                  title={llm.modelId ?? undefined}
                  wrap
                />
              );
            })()}
          </div>

          {(() => {
            const role = resolveSparkRole(spark);
            if (role === "worker") return <p className="node-throughput text-xs text-muted">参与分布式推理 · 吞吐与延迟见主节点模型服务</p>;
            const llmArr = spark.metrics.llm;
            const llm = Array.isArray(llmArr) ? llmArr.find((l) => l.available) : null;
            if (!llm) return null;
            return (
              <div className="node-throughput mt-3.5 grid grid-cols-2 gap-2 border-t border-border pt-3">
                <div className="text-center">
                  <span className="node-throughput-value font-tabular font-semibold text-text-strong">
                    {llm.generationTps.toFixed(0)}
                  </span>
                  <span className="node-throughput-label font-normal text-muted"> tok/s 吞吐量</span>
                </div>
                <div className="border-l border-border text-center">
                  <span className="node-throughput-value font-tabular font-semibold text-text-strong">
                    {llm.prefillTps.toFixed(0)}
                  </span>
                  <span className="node-throughput-label font-normal text-muted"> 预填充</span>
                </div>
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}

function ComparisonMetric({
  title,
  sparks,
  value,
  max,
  format,
  color,
}: {
  title: string;
  sparks: SparkSnapshot[];
  value: (spark: SparkSnapshot) => number | null;
  max: number;
  format: (value: number) => string;
  color?: (value: number, spark: SparkSnapshot) => string;
}) {
  return (
    <section className="comparison-metric">
      <h3>{title}</h3>
      <div className="comparison-metric__rows">
        {sparks.map((spark) => {
          const current = gpuReady(spark) ? value(spark) : null;
          const tone = current != null ? color?.(current, spark) : undefined;
          const width = Math.max(0, Math.min(100, max > 0 && current != null ? (current / max) * 100 : 0));
          return (
            <div className="comparison-metric__row" key={spark.id}>
              <div className="comparison-metric__label">
                <span>{spark.name}</span>
                <strong className="font-tabular">{current == null ? (spark.online ? '未采集' : '离线') : format(current)}</strong>
              </div>
              <div className="comparison-metric__track">
                <span
                  className={spark.role === 'worker' || spark.workerNode ? "is-worker" : "is-head"}
                  style={{ width: `${width}%`, ...(tone ? { background: `var(--color-${tone === 'bg-danger' ? 'danger' : tone === 'bg-warning' ? 'warning' : tone === 'bg-neutral' ? 'text' : spark.role === 'worker' || spark.workerNode ? 'chart-secondary' : 'chart-primary'})` } : {}) }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function OverviewPage({
  telemetryStale = false,
  sparks,
  hideOffline = false,
  hideWorkers = false,
  showFleetEnergy = false,
  showFleetExceptions = false,
  showOverviewSearch = false,
  temperatureUnit = "celsius",
  onSelectSpark,
}: OverviewPageProps) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "online" | "offline" | "issues">("all");
  const withoutWorkers = hideWorkers ? sparks.filter((s) => !isWorkerSpark(s)) : sparks;
  const visibleSparks = withoutWorkers.filter((spark) => {
    if (hideOffline && !spark.online) return false;
    if (showOverviewSearch && query && !spark.name.toLowerCase().includes(query.toLowerCase())) return false;
    if (showOverviewSearch && statusFilter === "online" && !spark.online) return false;
    if (showOverviewSearch && statusFilter === "offline" && spark.online) return false;
    if (showOverviewSearch && statusFilter === "issues" && nodeIssues(spark).length === 0) return false;
    return true;
  });
  const hiddenWorkerCount = hideWorkers ? sparks.filter(isWorkerSpark).length : 0;
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchMsg, setBatchMsg] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  const [shutdownOpen, setShutdownOpen] = useState(false);
  /** Spark ids we started a batch Hermes update on; drives the live progress bar. */
  const [batchRun, setBatchRun] = useState<string[] | null>(null);

  const onlineShutdownCount = sparks.filter((s) => s.online).length;
  const hermesMonitoredCount = sparks.filter((s) => s.hermes?.monitoring).length;
  const hermesPendingUpdateCount = sparks.filter((s) => s.hermes?.updateAvailable === true).length;

  // Live batch progress — counted from WS snapshots, not from the one-shot HTTP response.
  const batchProg = (() => {
    if (!batchRun || batchRun.length === 0) return null;
    let done = 0;
    let failed = 0;
    for (const id of batchRun) {
      const h = sparks.find((s) => s.id === id)?.hermes;
      if (!h) continue;
      if (h.status === "error") {
        done += 1;
        failed += 1;
      } else if (h.status === "success" || h.finishedAt != null) {
        done += 1;
      }
    }
    return { total: batchRun.length, done, failed };
  })();

  // Once every started update has settled (success/error), dismiss the progress bar.
  useEffect(() => {
    if (!batchRun || batchRun.length === 0) return;
    const settled = batchRun.reduce((n, id) => {
      const h = sparks.find((s) => s.id === id)?.hermes;
      if (!h) return n;
      return n + (h.status === "success" || h.status === "error" || h.finishedAt != null ? 1 : 0);
    }, 0);
    if (settled === batchRun.length) {
      const t = setTimeout(() => setBatchRun(null), 6000);
      return () => clearTimeout(t);
    }
  }, [batchRun, sparks]);

  async function handleUpdateAllHermes() {
    if (hermesMonitoredCount === 0) return;
    setBatchLoading(true);
    setBatchMsg(null);
    try {
      const res = await updateAllHermes();
      const started = res.results.filter((r) => r.started);
      const skipped = res.results.filter((r) => r.skipped).length;
      const failed = res.results.filter((r) => !r.ok && !r.skipped).length;
      const parts = [`${started.length} 个更新已启动`];
      if (skipped) parts.push(`${skipped} 个已跳过`);
      if (failed) parts.push(`${failed} 个失败`);
      setBatchMsg({
        text: parts.join(", "),
        tone: failed === 0 ? "ok" : "err",
      });
      // Merge with any in-flight batch instead of replacing (server may skip
      // already-running jobs, which must not clear a live progress bar).
      setBatchRun((prev) => {
        const ids = started.map((r) => r.id);
        if (ids.length === 0) return prev;
        return [...new Set([...(prev ?? []), ...ids])];
      });
    } catch (err: unknown) {
      setBatchMsg({
        text: err instanceof Error ? err.message : "批量更新 Hermes 失败",
        tone: "err",
      });
    } finally {
      setBatchLoading(false);
      setTimeout(() => setBatchMsg(null), 6000);
    }
  }

  async function handleShutdownAll() {
    if (onlineShutdownCount === 0) return;
    setBatchLoading(true);
    setBatchMsg(null);
    try {
      const res = await shutdownAllSparks();
      const ok = res.results.filter((r) => r.ok).length;
      const fail = res.results.filter((r) => !r.ok && !r.skipped).length;
      const skipped = res.results.filter((r) => r.skipped).length;
      const parts = [`${ok} 个节点已接受关机命令；等待节点状态确认`];
      if (fail) parts.push(`${fail} 个失败或未确认`);
      if (skipped) parts.push(`${skipped} 个已跳过`);
      setBatchMsg({
        text: parts.join(", "),
        tone: fail === 0 ? "ok" : "err",
      });
      if(!res.success)throw new Error(res.results.filter(r=>!r.ok).map(r=>`${sparks.find(s=>s.id===r.id)?.name||r.id}：${r.error||'未执行'}`).join('；'));
    } catch (err: unknown) {
      setBatchMsg({
        text: err instanceof Error ? err.message : "批量关机失败或结果未确认",
        tone: "err",
      });
      throw err;
    } finally {
      setBatchLoading(false);
      setTimeout(() => setBatchMsg(null), 6000);
    }
  }

  async function handleWakeAll() {
    setBatchLoading(true);
    setBatchMsg(null);
    try {
      const res = await wakeAllSparks();
      const ok = res.results.filter((r) => r.ok).length;
      const fail = res.results.filter((r) => !r.ok).length;
      setBatchMsg({
        text: fail === 0 ? `已发送 ${ok} 个唤醒包` : `${ok} 个已发送，${fail} 个失败`,
        tone: fail === 0 ? "ok" : "err",
      });
    } catch (err: unknown) {
      setBatchMsg({
        text: err instanceof Error ? err.message : "批量唤醒失败",
        tone: "err",
      });
    } finally {
      setBatchLoading(false);
      setTimeout(() => setBatchMsg(null), 6000);
    }
  }

  if (withoutWorkers.length === 0 || (hideOffline && withoutWorkers.every((spark) => !spark.online))) {
    const allWorkersHidden = hideWorkers && sparks.length > 0 && withoutWorkers.length === 0;
    const allOffline = hideOffline && withoutWorkers.length > 0;
    const title = allWorkersHidden
      ? "工作节点已隐藏"
      : allOffline
        ? "所有节点均离线"
        : "尚未添加节点";
    const detail = allWorkersHidden
      ? "设置中已开启隐藏工作节点，关闭该选项即可重新显示。"
      : allOffline
        ? "已开启自动隐藏，目前没有在线节点。"
        : "点击 + 标签添加 DGX Spark 节点。";
    return (
      <><OperationsPanel sparks={sparks} stale={telemetryStale} onSelect={onSelectSpark}/><div className="panel mx-auto mt-16 max-w-md p-8 text-center">
        <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-accent">
          <ActivityIcon className="h-5 w-5" />
        </div>
        <h2 className="text-sm font-semibold text-text-strong">{title}</h2>
        <p className="mt-1 text-xs text-muted">{detail}</p>
      </div></>
    );
  }

  const onlineCount = visibleSparks.filter((s) => s.online).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--density-overview-rhythm)" }}>
      {showFleetEnergy ? <FleetEnergyCard nodeCount={sparks.length} /> : null}
      {showFleetExceptions ? <FleetAlertStrip sparks={sparks} onSelect={onSelectSpark} /> : null}
      <div className="overview-heading flex flex-wrap items-center justify-between gap-6">
        <div>
          <h1 className="font-semibold leading-tight tracking-tight text-text-strong">双机对比</h1>
          <p className="mt-1 text-xs text-muted">实时监控 DGX Spark 集群运行状态</p>
        </div>
        <div className="flex flex-wrap items-end justify-end gap-3">
          {batchMsg && (
            <span className={`text-[11px] ${batchMsg.tone === "ok" ? "text-success" : "text-danger"}`}>
              {batchMsg.text}
            </span>
          )}
          {batchProg && (
            <div className="flex flex-col items-end gap-1">
              <span className="flex items-center gap-1.5 text-[11px] text-muted">
                <RotateIcon className="h-3 w-3" />
                正在更新 Hermes — {batchProg.done}/{batchProg.total}
                {batchProg.failed > 0 && (
                  <span className="text-danger">({batchProg.failed} 失败）</span>
                )}
                <button
                  type="button"
                  onClick={() => setBatchRun(null)}
                  aria-label="关闭更新进度提示"
                  title="关闭提示"
                  className="rounded p-0.5 text-muted transition-colors hover:bg-surface-hover hover:text-text"
                >
                  <span className="text-xs leading-none">✕</span>
                </button>
              </span>
              <div className="h-1 w-36 overflow-hidden rounded-full bg-border">
                <div
                  className={`h-full rounded-full transition-[width] duration-300 ease-out ${
                    batchProg.failed > 0 ? "bg-danger" : "bg-accent"
                  }`}
                  style={{
                    width: `${batchProg.total > 0 ? Math.round((batchProg.done / batchProg.total) * 100) : 0}%`,
                  }}
                />
              </div>
            </div>
          )}
          {sparks.length > 0 && (
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {hermesMonitoredCount > 0 && (
                <button
                  type="button"
                  onClick={() => void handleUpdateAllHermes()}
                  disabled={batchLoading}
                  title="在所有启用 Hermes Agent 的节点上执行 hermes update"
                  className={`flex items-center gap-1 rounded-md border bg-surface-elevated px-2.5 py-1.5 text-[11px] transition-colors disabled:opacity-50 ${
                    hermesPendingUpdateCount > 0
                      ? "border-warning/40 text-warning hover:bg-warning/15"
                      : "border-border text-muted hover:bg-surface-hover hover:text-text"
                  }`}
                >
                  <RotateIcon className="h-3 w-3" />
                  更新 Hermes
                  {hermesPendingUpdateCount > 0 && (
                    <span
                      className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[9px] font-bold leading-none text-white"
                      title={`${hermesPendingUpdateCount} Spark${hermesPendingUpdateCount === 1 ? "" : "s"} with a Hermes update available`}
                    >
                      {hermesPendingUpdateCount}
                    </span>
                  )}
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleWakeAll()}
                disabled={batchLoading}
                title="向所有已配置 MAC 地址的节点发送局域网唤醒包"
                className="flex items-center gap-1 rounded-md border border-border bg-surface-elevated px-2.5 py-1.5 text-[11px] text-muted hover:bg-success/20 hover:text-success transition-colors disabled:opacity-50"
              >
                <PowerOnIcon className="h-3 w-3" />
                全部唤醒
              </button>
              <button
                type="button"
                onClick={() => setShutdownOpen(true)}
                disabled={batchLoading || onlineShutdownCount === 0}
                title="关闭全部在线节点"
                className="flex items-center gap-1 rounded-md border border-border bg-surface-elevated px-2.5 py-1.5 text-[11px] text-muted transition-colors hover:bg-danger/20 hover:text-danger disabled:opacity-50"
              >
                <PowerOffIcon className="h-3 w-3" />
                全部关机
              </button>
            </div>
          )}
          <span className="online-chip">
            <span className="dot" />
            {onlineCount} / {visibleSparks.length} 在线
          </span>
          {hiddenWorkerCount > 0 && (
            <span className="text-[11px] text-muted">
              {hiddenWorkerCount} 工作节点{hiddenWorkerCount === 1 ? "" : "s"} 已隐藏
            </span>
          )}
        </div>
      </div>
      <section className="cluster-health" aria-label="可见节点状态">
        <div className="cluster-health__primary">
          <span className="text-sm font-semibold text-text-strong">可见节点状态</span>
          <span className={`cluster-health__dot ${onlineCount === visibleSparks.length ? "is-ok" : "is-warning"}`} />
          <strong className={`font-tabular ${telemetryStale || onlineCount !== visibleSparks.length ? 'text-warning' : 'text-success'}`}>{telemetryStale ? '数据已过期' : `${onlineCount} / ${visibleSparks.length} 在线`}</strong>
        </div>
        <div className="cluster-health__stats">
          <span>主节点 <strong className="font-tabular">{visibleSparks.filter((s) => resolveSparkRole(s) === "head").length}</strong></span>
          <span>工作节点 <strong className="font-tabular">{visibleSparks.filter((s) => resolveSparkRole(s) === "worker").length}</strong></span>
          <span>离线节点 <strong className="font-tabular">{visibleSparks.length - onlineCount}</strong></span>
        </div>
      </section>
      {visibleSparks.length > 0 ? (
        <section className="comparison-band" aria-label="实时指标数据">
          <div className="comparison-band__header">
            <div>
              <h2>实时指标数据</h2>
              <p>两个节点的当前负载与资源状态</p>
            </div>
            <span className="text-[11px] text-muted">实时刷新</span>
          </div>
          <div className="comparison-band__grid">
            <ComparisonMetric title="GPU 使用率" sparks={visibleSparks} value={(s) => telemetryStale ? null : finite(s.metrics.gpu?.usage)} max={100} format={(v) => `${Math.round(v)}%`} />
            <ComparisonMetric title="GPU 温度" sparks={visibleSparks} color={(v) => temperatureColor(v, temperatureUnit)} value={(s) => telemetryStale || !s.metrics.gpu?.temperature ? null : s.metrics.gpu.temperature} max={100} format={(v) => temperatureUnit === 'fahrenheit' ? `${celsiusToFahrenheit(v)}°F` : `${Math.round(v)}°C`} />
            <ComparisonMetric title="GPU 内存分配" sparks={visibleSparks} value={(s) => telemetryStale ? null : finite(s.metrics.gpu?.vram?.used)} max={Math.max(1,...visibleSparks.map((s) => s.metrics.gpu?.vram?.total ?? 0))} format={(v) => formatMb(v)} />
            <ComparisonMetric title="GPU 功耗（非整机）" sparks={visibleSparks} color={(_, s) => temperatureColor(s.metrics.gpu?.temperature ?? 0, temperatureUnit)} value={(s) => telemetryStale ? null : finite(s.metrics.gpu?.power.draw)} max={Math.max(1,...visibleSparks.map(s=>s.metrics.gpu?.power.limit??0))} format={(v) => `${v.toFixed(1)} W`} />
          </div>
        </section>
      ) : null}
      <OperationsPanel sparks={sparks} stale={telemetryStale} onSelect={onSelectSpark}/>
      {showOverviewSearch ? (
      <div className="flex flex-wrap gap-2" role="search" aria-label="筛选集群节点">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索节点（最多 12 台）"
          aria-label="按名称搜索节点"
          className="min-h-11 min-w-52 flex-1 rounded border border-border bg-surface-elevated px-3 text-sm text-text"
        />
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
          aria-label="按状态筛选节点"
          className="min-h-11 rounded border border-border bg-surface-elevated px-3 text-sm text-text"
        >
          <option value="all">全部状态</option>
          <option value="online">在线</option>
          <option value="offline">离线</option>
          <option value="issues">异常</option>
        </select>
      </div>
      ) : null}
      <ConfirmShutdownDialog
        open={shutdownOpen}
        targets={sparks.filter(s=>s.online).map(s=>({id:s.id,name:s.name}))}
        onClose={() => setShutdownOpen(false)}
        onConfirm={handleShutdownAll}
        title="全部关机"
        description={`确认关闭全部 ${onlineShutdownCount} 个在线节点？离线节点将跳过。需要各宿主机已有的关机脚本；连接中断不代表已关机。`}
        confirmLabel="全部关机"
      />
      <div className="overview-page overview-comparison grid sm:grid-cols-2" style={{ gap: "var(--density-page-gap)" }}>
        {visibleSparks.length === 0 && (
          <p className="panel p-6 text-sm text-muted sm:col-span-2 lg:col-span-3">
            没有符合当前筛选条件的节点。
          </p>
        )}
        {visibleSparks.map((spark) => (
          <SparkCard
            key={spark.id}
            spark={spark}
            headSparkName={
              spark.workerHeadId
                ? sparks.find((s) => s.id === spark.workerHeadId)?.name ?? null
                : null
            }
            temperatureUnit={temperatureUnit}
            onSelect={onSelectSpark}
          />
        ))}
      </div>
    </div>
  );
}
