import { displayName } from '../../displayName';
import { useEffect, useState, type ReactNode } from "react";
import type { SparkSnapshot } from "../../api/types";
import { isWorkerSpark, resolveSparkRole } from "../../api/sparkRole";
import { shutdownAllSparks, updateAllHermes, wakeAllSparks } from "../../api/client";
import { ConfirmShutdownDialog } from "../ConfirmShutdownDialog";
import { FleetEnergyCard } from "./FleetEnergyCard";
import { FleetAlertStrip } from "./FleetAlertStrip";
import { ActivityIcon, PowerOffIcon, PowerOnIcon, RotateIcon } from "../ui/icons";
import { OperationsPanel } from './OperationsPanel';
import { finite, gpuReady, nodeIssues, type Operations } from './operationsModel';
import { temperatureColor } from './temperatureColor';
import { SparkHero } from './SparkHero';
import { CockpitNodeCard } from './CockpitNodeCard';
import { TokenLedgerCard } from './TokenLedgerCard';
import { openWorkspace, type Workspace } from '../../hooks/useWorkspaceRoute';
import { TestTools } from './TestTools';

interface OverviewPageProps {
  nodeControls?: ReactNode;
  workspace?: Workspace;
  benchShareImage?: boolean;
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
                <span>{displayName(spark.name)}</span>
                <strong className="font-tabular">{current == null ? (spark.online ? '未采集' : '离线') : format(current)}</strong>
              </div>
              <div className="comparison-metric__track">
                <span
                  data-unavailable={current == null}
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
  nodeControls,
  workspace = 'overview',
  benchShareImage = false,
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
  const [nodeView, setNodeView] = useState<'cards'|'compare'>('cards');
  const [analysisTab, setAnalysisTab] = useState<'history'|'energy'|'tokens'>('history');
  const [diagnosticTab, setDiagnosticTab] = useState<'network'|'events'>('network');
  const isSummary = workspace === 'overview';
  const isNodes = workspace === 'nodes';
  const searchEnabled = showOverviewSearch || isNodes;
  const titles = {overview:'AI 集群监控',service:'模型服务',nodes:'节点监控',tests:'测试工具',analysis:'运行分析',diagnostics:'诊断'};
  const descriptions = {overview:'服务状态、请求负载与多节点协同',service:'当前负载、服务质量与验收记录',nodes:'设备资源、节点对比与硬件详情',tests:'按目的选择测试，手动开始才会发送请求',analysis:'历史表现、能耗与 Token 用量',diagnostics:'区分采集异常、主机状态与模型问题'};
  const [operations, setOperations] = useState<Operations | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "online" | "offline" | "issues">("all");
  const withoutWorkers = hideWorkers && !isNodes ? sparks.filter((s) => !isWorkerSpark(s)) : sparks;
  const visibleSparks = withoutWorkers.filter((spark) => {
    if (hideOffline && isSummary && !spark.online) return false;
    if (searchEnabled && query && !spark.name.toLowerCase().includes(query.toLowerCase())) return false;
    if (searchEnabled && statusFilter === "online" && !spark.online) return false;
    if (searchEnabled && statusFilter === "offline" && spark.online) return false;
    if (searchEnabled && statusFilter === "issues" && nodeIssues(spark).length === 0) return false;
    return true;
  });
  const hiddenWorkerCount = hideWorkers && isSummary ? sparks.filter(isWorkerSpark).length : 0;
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

  if ((isSummary||isNodes) && (withoutWorkers.length === 0 || (isSummary&&hideOffline && withoutWorkers.every((spark) => !spark.online)))) {
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
        : "在节点监控中点击“添加节点”，配置 DGX Spark 设备。";
    return (
      <>{isNodes && nodeControls}<div className="panel mx-auto mt-16 max-w-md p-8 text-center">
        <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-accent">
          <ActivityIcon className="h-5 w-5" />
        </div>
        <h2 className="text-sm font-semibold text-text-strong">{title}</h2>
        <p className="mt-1 text-xs text-muted">{detail}</p>
        {!isNodes&&<button className="workspace-text-link" onClick={()=>openWorkspace('nodes')}>打开节点监控</button>}
      </div></>
    );
  }

  return (
    <div className="cockpit-overview" style={{ display: "flex", flexDirection: "column", gap: "var(--density-overview-rhythm)" }}>
      {(isSummary && !telemetryStale && (showFleetExceptions || sparks.some(s=>nodeIssues(s).length>0))) ? <FleetAlertStrip sparks={sparks} onSelect={onSelectSpark} /> : null}
      <div className={`overview-heading overview-heading--${workspace} flex flex-wrap items-center justify-between gap-6`}>
        <div className="overview-title-copy">
          <h1 className="font-semibold leading-tight tracking-tight text-text-strong">{titles[workspace]}</h1>
          <p className="overview-subtitle mt-1 text-xs text-muted">{descriptions[workspace]}</p>
          {hiddenWorkerCount > 0 && (
            <p className="mt-1 text-xs text-muted">{hiddenWorkerCount} 个工作节点已隐藏</p>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {isNodes && nodeControls}
          {batchMsg && (
            <span role="status" className={`text-[11px] leading-5 ${batchMsg.tone === "ok" ? "text-success" : "text-danger"}`}>
              {batchMsg.text}
            </span>
          )}
          {batchProg && (
            <div className="flex flex-col items-end gap-1">
              <span className="flex items-center gap-1.5 text-[11px] text-muted">
                <RotateIcon className="h-3 w-3" />
                正在更新 Hermes — {batchProg.done}/{batchProg.total}
                {batchProg.failed > 0 && (
                  <span className="text-danger">（{batchProg.failed} 失败）</span>
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
                  className={`telemetry-progress-fill h-full rounded-full transition-[width] duration-300 ease-out ${
                    batchProg.failed > 0 ? "bg-danger" : "bg-accent"
                  }`}
                  style={{
                    width: `${batchProg.total > 0 ? Math.round((batchProg.done / batchProg.total) * 100) : 0}%`,
                  }}
                />
              </div>
            </div>
          )}
          {(isSummary || isNodes) && sparks.length > 0 && (
            <div className="overview-power-actions flex flex-wrap items-center justify-end gap-1.5">
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
                      title={`${hermesPendingUpdateCount} 个节点有可用的 Hermes 更新`}
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
        </div>
      </div>
      {isSummary && <><SparkHero compact sparks={sparks} stale={telemetryStale} onSelect={onSelectSpark} operations={operations} /><div className="workspace-section-heading"><h2 className="cockpit-nodes-heading">{sparks.length === 4 ? '节点协同' : '设备协同'}</h2><button className="workspace-text-link" onClick={()=>openWorkspace('nodes')}>节点详情与对比</button></div></>}
      {isNodes && <div className="workspace-subnav" aria-label="节点视图"><button aria-pressed={nodeView==='cards'} onClick={()=>setNodeView('cards')}>节点卡片</button><button aria-pressed={nodeView==='compare'} onClick={()=>setNodeView('compare')}>指标对比</button></div>}
      {(isSummary || isNodes) && (showOverviewSearch || isNodes) ? (
      <div className="node-filters flex flex-wrap gap-2" role="search" aria-label="筛选集群节点">
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
      {(isSummary || isNodes && nodeView === 'cards') && <div className="overview-page overview-comparison cockpit-node-rail grid" tabIndex={0} role="region" aria-label="设备节点，可横向滚动" style={{ gap: "var(--density-page-gap)" }}>
        {visibleSparks.length === 0 && (
          <div className="panel node-filter-empty p-6 text-sm text-muted" role="status" style={{gridColumn:'1 / -1'}}>
            <p>没有符合当前筛选条件的节点。</p><button onClick={()=>{setQuery('');setStatusFilter('all');}}>清除筛选</button>
          </div>
        )}
        {visibleSparks.map((spark) => (
          <CockpitNodeCard
            key={spark.id}
            spark={spark}
            headSpark={
              spark.workerHeadId
                ? sparks.find((s) => s.id === spark.workerHeadId && resolveSparkRole(s) === 'head')
                : undefined
            }
            stale={telemetryStale}
            temperatureUnit={temperatureUnit}
            onSelect={onSelectSpark}
          />
        ))}
      </div>}
      {isNodes && nodeView === 'compare' && visibleSparks.length > 0 ? (
        <section className="comparison-band" aria-label="实时指标数据">
          <div className="comparison-band__header">
            <div>
              <h2>节点指标对比</h2>
              <p>集群各节点的当前负载与资源状态</p>
            </div>
            <span className="text-[11px] text-muted">实时刷新</span>
          </div>
          <div className="comparison-band__grid">
            <ComparisonMetric title="GPU 使用率" sparks={visibleSparks} value={(s) => telemetryStale ? null : finite(s.metrics.gpu?.usage)} max={100} format={(v) => `${Math.round(v)}%`} />
            <ComparisonMetric title="GPU 温度" sparks={visibleSparks} color={(v) => temperatureColor(v, temperatureUnit)} value={(s) => telemetryStale || !s.metrics.gpu?.temperature ? null : s.metrics.gpu.temperature} max={100} format={(v) => temperatureUnit === 'fahrenheit' ? `${celsiusToFahrenheit(v)}°F` : `${Math.round(v)}°C`} />
            <ComparisonMetric title="GPU 内存占用" sparks={visibleSparks} value={(s) => telemetryStale ? null : finite(s.metrics.gpu?.vram?.used)} max={Math.max(1,...visibleSparks.map((s) => s.metrics.gpu?.vram?.total ?? 0))} format={(v) => formatMb(v)} />
            <ComparisonMetric title="GPU 功耗（非整机）" sparks={visibleSparks} color={(_, s) => temperatureColor(s.metrics.gpu?.temperature ?? 0, temperatureUnit)} value={(s) => telemetryStale ? null : finite(s.metrics.gpu?.power.draw)} max={Math.max(1,...visibleSparks.map(s=>s.metrics.gpu?.power.limit??0))} format={(v) => `${v.toFixed(1)} W`} />
          </div>
        </section>
      ) : null}
      {workspace === 'tests' && <TestTools sparks={sparks} shareImage={benchShareImage} />}
      {workspace === 'analysis' && <div className="workspace-subnav" aria-label="分析分类">{([['history','性能历史'],['energy','能耗效率'],['tokens','Token 用量']] as const).map(([id,label])=><button key={id} aria-pressed={analysisTab===id} onClick={()=>setAnalysisTab(id)}>{label}</button>)}</div>}
      {workspace === 'diagnostics' && <div className="workspace-subnav" aria-label="诊断分类"><button aria-pressed={diagnosticTab==='network'} onClick={()=>setDiagnosticTab('network')}>采集与互联</button><button aria-pressed={diagnosticTab==='events'} onClick={()=>setDiagnosticTab('events')}>采集事件</button></div>}
      {(isSummary || workspace === 'service' || workspace === 'analysis' && analysisTab !== 'tokens' || workspace === 'diagnostics') && <OperationsPanel sparks={sparks} stale={telemetryStale} onSelect={onSelectSpark} onData={setOperations} view={isSummary?'summary':workspace==='service'?'service':workspace==='analysis'?analysisTab==='energy'?'energy':'history':diagnosticTab}/>}
      {isNodes && nodeView === 'compare' && visibleSparks.length === 0 && <div className="panel node-filter-empty p-6 text-sm text-muted" role="status"><p>没有符合当前筛选条件的节点。</p><button onClick={()=>{setQuery('');setStatusFilter('all');}}>清除筛选</button></div>}
      {isSummary && <div className="overview-next-actions"><button onClick={()=>openWorkspace('service')}>模型性能与验收</button><button onClick={()=>openWorkspace('analysis')}>历史与用量</button>{showFleetEnergy&&<button onClick={()=>{setAnalysisTab('energy');openWorkspace('analysis');}}>能耗估算</button>}<button onClick={()=>openWorkspace('diagnostics')}>采集状态与诊断</button></div>}
      <ConfirmShutdownDialog
        open={shutdownOpen}
        targets={sparks.filter(s=>s.online).map(s=>({id:s.id,name:s.name}))}
        onClose={() => setShutdownOpen(false)}
        onConfirm={handleShutdownAll}
        title="全部关机"
        description={`确认关闭全部 ${onlineShutdownCount} 个在线节点？离线节点将跳过。需要各宿主机已有的关机脚本；连接中断不代表已关机。`}
        confirmLabel="全部关机"
      />
      {workspace === 'analysis' && analysisTab === 'tokens' && <TokenLedgerCard defaultOpen />}
    </div>
  );
}
