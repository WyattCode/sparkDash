import { useState, useCallback, useEffect, useMemo } from "react";
import { useSnapshot } from "./hooks/useSnapshot";
import { useAppRoute, useRoute } from "./hooks/useRoute";
import { fetchSparks, reorderSparks } from "./api/client";
import { SparkTabs } from "./components/SparkTabs";
import { AddSparkDialog } from "./components/AddSparkDialog";
import { EditSparkDialog } from "./components/EditSparkDialog";
import { SparkPage } from "./components/SparkPage/SparkPage";
import { HermesUpdateDialog } from "./components/SparkPage/HermesUpdateDialog";
import { OverviewPage } from "./components/OverviewPage/OverviewPage";
import { ShowcasePage } from "./components/ShowcasePage/ShowcasePage";
import { ThemeSwitch } from "./components/ThemeSwitch";
import { SettingsDialog } from "./components/SettingsDialog";
import { GearIcon, BoltIcon } from "./components/ui/icons";
import { ConnectionBanner } from "./components/ui/ConnectionBanner";
import { ErrorBanner } from "./components/ui/ErrorBanner";
import { OVERVIEW_ID } from "./constants";
import type { SparkSnapshot } from "./api/types";
import { isWorkerSpark } from "./api/sparkRole";
import { useStartupPending } from "./hooks/useStartupPending";
import { useDashboardSettings } from "./hooks/useDashboardSettings";

/** Keep hidden worker ids in their original slots when the visible tabs are reordered. */
function mergeTabOrderKeepingHidden(
  allSparks: SparkSnapshot[],
  visibleOrder: string[],
  hiddenIds: Set<string>
): string[] {
  if (hiddenIds.size === 0) return visibleOrder;
  const result: string[] = [];
  let vi = 0;
  for (const spark of allSparks) {
    if (hiddenIds.has(spark.id)) {
      result.push(spark.id);
    } else if (vi < visibleOrder.length) {
      result.push(visibleOrder[vi++]);
    }
  }
  while (vi < visibleOrder.length) result.push(visibleOrder[vi++]);
  return result;
}

function placeholderSnapshot(
  id: string,
  name: string,
  disabledDevices: string[] = [],
  disabledInterfaces: string[] = [],
  llmPorts: number[] = [8888],
  roleFields?: {
    role?: SparkSnapshot["role"];
    workerNode?: boolean;
    workerLabel?: string | null;
    workerHeadId?: string | null;
    llmMonitoring?: boolean;
    comfyMonitoring?: boolean;
    comfyPort?: number;
    tailscaleMonitoring?: boolean;
    kind?: "spark" | "host";
  }
): SparkSnapshot {
  const role =
    roleFields?.role === "head" ||
    roleFields?.role === "worker" ||
    roleFields?.role === "standalone"
      ? roleFields.role
      : roleFields?.workerNode
        ? "worker"
        : "standalone";
  const workerNode = role === "worker";
  return {
    id,
    name,
    kind: roleFields?.kind ?? "spark",
    online: false,
    uptime: null,
    disabledDevices,
    disabledInterfaces,
    llmPort: llmPorts[0] ?? 8888,
    llmPorts,
    workerNode,
    role,
    workerLabel: workerNode ? roleFields?.workerLabel ?? null : null,
    workerHeadId: workerNode ? roleFields?.workerHeadId ?? null : null,
    llmMonitoring:
      role === "worker"
        ? false
        : role === "head"
          ? true
          : roleFields?.llmMonitoring !== false,
    comfyMonitoring: Boolean(roleFields?.comfyMonitoring),
    comfyPort: roleFields?.comfyPort ?? 8188,
    tailscaleMonitoring: Boolean(roleFields?.tailscaleMonitoring),
    hermes: {
      monitoring: false,
      installed: null,
      version: null,
      updateAvailable: null,
      behindCommits: null,
      checkedAt: null,
      status: "idle",
      startedAt: null,
      finishedAt: null,
      error: null,
    },
    hardware: {
      device: "NVIDIA DGX Spark",
      cpuModel: "…",
      cpuCores: 0,
      totalMemoryGB: 0,
      gpuChip: "…",
      cudaDriver: null,
      storageModel: null,
    },
    metrics: {
      gpu: null,
      cpu: null,
      ram: null,
      storage: [],
      network: null,
      unifiedMemory: null,
      llm: [],
      comfy: null,
      tailscale: null,
    },
  };
}

function DashboardApp() {
  const {
    sparks,
    activeId,
    setActiveId,
    activeSpark,
    connected,
    lastValidSnapshotAt,
    snapshotError,
    refreshInterval,
  } = useSnapshot();
  const [telemetryNow, setTelemetryNow] = useState(Date.now());
  const navigate = useRoute(setActiveId);
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const { settings, settingsSettled, handleSettingsSaved } = useDashboardSettings(setActionError);
  const startupPending = useStartupPending(lastValidSnapshotAt != null, settingsSettled);
  /** Used when WS is down so add/delete still updates the tab bar */
  const [fallbackSparks, setFallbackSparks] = useState<SparkSnapshot[]>([]);
  const staleAfterMs = Math.max(10_000, 3 * (refreshInterval ?? 2_000));
  const telemetryStale =
    lastValidSnapshotAt != null && telemetryNow - lastValidSnapshotAt > staleAfterMs;

  useEffect(() => {
    if (lastValidSnapshotAt == null) return;
    setTelemetryNow(Date.now());
    const timer = window.setInterval(() => setTelemetryNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [lastValidSnapshotAt]);

  // Prefer live WS data; fall back to API-fetched list when empty
  const liveSparks = sparks.length > 0 ? sparks : fallbackSparks;
  /** Optimistic tab order while drag-save races the next WS snapshot */
  const [orderOverride, setOrderOverride] = useState<string[] | null>(null);

  const displaySparks = useMemo(() => {
    if (!orderOverride?.length) return liveSparks;
    const map = new Map(liveSparks.map((s) => [s.id, s]));
    const ordered: SparkSnapshot[] = [];
    for (const id of orderOverride) {
      const s = map.get(id);
      if (s) {
        ordered.push(s);
        map.delete(id);
      }
    }
    for (const s of map.values()) ordered.push(s);
    return ordered;
  }, [liveSparks, orderOverride]);

  // Drop override once server/WS order matches
  useEffect(() => {
    if (!orderOverride) return;
    const live = liveSparks.map((s) => s.id).join("\0");
    if (live === orderOverride.join("\0")) setOrderOverride(null);
  }, [liveSparks, orderOverride]);


  const isOverview = activeId === OVERVIEW_ID;
  const hideWorkers = settings?.hideWorkers ?? false;
  const hiddenWorkerIds = useMemo(() => {
    if (!hideWorkers) return new Set<string>();
    return new Set(
      displaySparks
        .filter((s) => isWorkerSpark(s) && s.id !== activeId)
        .map((s) => s.id)
    );
  }, [displaySparks, hideWorkers, activeId]);
  const tabSparks = useMemo(
    () => (hideWorkers ? displaySparks.filter((s) => !hiddenWorkerIds.has(s.id)) : displaySparks),
    [displaySparks, hideWorkers, hiddenWorkerIds]
  );
  const displayActive = isOverview
    ? null
    : displaySparks.find((s) => s.id === activeId) || displaySparks[0] || activeSpark || null;

  useEffect(() => {
    if (sparks.length > 0) setFallbackSparks([]);
  }, [sparks]);

  // Apply layout density (comfortable/compact) from persisted settings.
  useEffect(() => {
    if (settings?.density) {
      document.documentElement.setAttribute("data-density", settings.density);
      try { localStorage.setItem("sparkdash-density", settings.density); } catch { /* Optional cache. */ }
    }
  }, [settings?.density]);

  const refreshFromApi = useCallback(async () => {
    try {
      const { sparks: configs } = await fetchSparks();
      setFallbackSparks(
        configs.map((c) => {
          const existing = sparks.find((s) => s.id === c.id);
          if (existing) {
            // Keep live metrics, but never let a stale WS snapshot override
            // role fields that were just saved via the API.
            return {
              ...existing,
              name: c.name,
              role: c.role ?? existing.role,
              workerNode: c.workerNode ?? existing.workerNode,
              workerLabel: c.workerLabel ?? existing.workerLabel,
              workerHeadId: c.workerHeadId ?? existing.workerHeadId,
              llmMonitoring: c.llmMonitoring ?? existing.llmMonitoring,
              comfyMonitoring: c.comfyMonitoring ?? existing.comfyMonitoring,
              comfyPort: c.comfyPort ?? existing.comfyPort,
              tailscaleMonitoring: c.tailscaleMonitoring ?? existing.tailscaleMonitoring,
              disabledDevices: c.disabledDevices || existing.disabledDevices,
              disabledInterfaces: c.disabledInterfaces || existing.disabledInterfaces,
              llmPorts: c.llmPorts ?? existing.llmPorts,
              llmPort: c.llmPorts?.[0] ?? c.llmPort ?? existing.llmPort,
              kind: c.kind ?? existing.kind,
            };
          }
          return placeholderSnapshot(
            c.id,
            c.name,
            c.disabledDevices || [],
            c.disabledInterfaces || [],
            c.llmPorts ?? (c.llmPort ? [c.llmPort] : [8888]),
            {
              role: c.role,
              workerNode: c.workerNode,
              workerLabel: c.workerLabel,
              workerHeadId: c.workerHeadId,
              llmMonitoring: c.llmMonitoring,
              comfyMonitoring: c.comfyMonitoring,
              comfyPort: c.comfyPort,
              tailscaleMonitoring: c.tailscaleMonitoring,
              kind: c.kind,
            }
          );
        })
      );
      if (configs.length && activeId !== OVERVIEW_ID && !configs.some((c) => c.id === activeId)) {
        setActiveId(configs[0].id);
      }
      if (configs.length === 0 && activeId !== OVERVIEW_ID) setActiveId(null);
    } catch (err) {
      console.error("Failed to refresh sparks:", err);
      setActionError(
        `无法刷新节点：${err instanceof Error ? err.message : String(err)}。仍显示上次数据。`
      );
    }
  }, [sparks, activeId, setActiveId]);

  const handleReorder = useCallback(
    async (orderedIds: string[]) => {
      const next = mergeTabOrderKeepingHidden(displaySparks, orderedIds, hiddenWorkerIds);
      setOrderOverride(next);
      try {
        await reorderSparks(next);
      } catch (err) {
        console.error("Failed to reorder Sparks:", err);
        setOrderOverride(null);
        setActionError(
          `无法保存节点顺序：${err instanceof Error ? err.message : String(err)}。已恢复原顺序。`
        );
      }
    },
    [displaySparks, hiddenWorkerIds]
  );

  if (startupPending) return <div className="app-frame startup-screen" role="status" aria-live="polite">正在加载监控…</div>;

  return (
    <div className="app-frame min-h-screen text-text">
      <div className="dashboard-shell">
        <header className="dashboard-topbar flex flex-wrap items-center gap-3">
          <a
            href="/"
            aria-label="sparkDash 首页并刷新"
            title="返回首页并刷新页面"
            className="logo-pill"
          >
            <BoltIcon className="h-3.5 w-3.5 text-accent" />
            <span>
              spark<span className="logo-pill-dash" translate="no">Dash</span>
            </span>
          </a>
          <SparkTabs
            sparks={tabSparks}
            activeId={displayActive?.id ?? activeId}
            onSelect={navigate}
            onAdd={() => setShowAdd(true)}
            onEdit={(id) => setEditId(id)}
            onReorder={handleReorder}
          />
          <div className="ml-auto flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="icon-circle"
              title="设置"
              aria-label="设置"
            >
              <GearIcon className="h-4 w-4" />
            </button>
            <ThemeSwitch />
          </div>
        </header>
        <ConnectionBanner
          connected={connected}
          lastValidSnapshotAt={lastValidSnapshotAt}
          snapshotError={snapshotError}
          now={telemetryNow}
          stale={telemetryStale}
        />
        <ErrorBanner message={actionError} onDismiss={() => setActionError(null)} />
        <main className={telemetryStale || !connected ? "telemetry-stale" : undefined}>
          {isOverview ? (
            <OverviewPage
              telemetryStale={telemetryStale || !connected}
              sparks={displaySparks}
              hideOffline={settings?.autoHideOffline ?? false}
              hideWorkers={hideWorkers}
              showFleetEnergy={settings?.showFleetEnergy ?? false}
              showFleetExceptions={settings?.showFleetExceptions ?? false}
              showOverviewSearch={settings?.showOverviewSearch ?? false}
              temperatureUnit={settings?.temperatureUnit ?? "celsius"}
              onSelectSpark={navigate}
            />
          ) : displayActive ? (
            <SparkPage
              spark={displayActive}
              temperatureUnit={settings?.temperatureUnit ?? "celsius"}
              onEdit={() => setEditId(displayActive.id)}
            />
          ) : (
            <div className="panel mx-auto mt-16 max-w-md p-8 text-center">
              <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-accent">
                <span className="text-lg leading-none">+</span>
              </div>
              <h2 className="text-sm font-semibold text-text-strong">尚未添加设备</h2>
              <p className="mt-1 text-xs text-muted">
                点击
                <span className="rounded border border-border bg-surface-elevated px-1 py-0.5 text-text">+</span>
                标签以添加 DGX Spark 设备。
              </p>
            </div>
          )}
        </main>
      </div>
      <HermesUpdateDialog />
      <AddSparkDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onAdded={() => {
          void refreshFromApi();
        }}
        defaultLlmPort={settings?.defaultLlmPort ?? 8888}
      />
      <EditSparkDialog
        open={editId != null}
        sparkId={editId}
        onClose={() => setEditId(null)}
        onSaved={() => {
          void refreshFromApi();
        }}
        onDeleted={(id) => {
          if (activeId === id) {
            const next = displaySparks.find((s) => s.id !== id);
            navigate(next?.id ?? OVERVIEW_ID);
          }
          void refreshFromApi();
        }}
      />
      <SettingsDialog
        open={showSettings}
        onClose={() => setShowSettings(false)}
        onSaved={handleSettingsSaved}
      />
    </div>
  );
}

function App() {
  const route = useAppRoute();
  if (route.mode === "showcase" && route.showcaseSparkId) {
    return <ShowcasePage sparkId={route.showcaseSparkId} />;
  }
  return <DashboardApp />;
}

export default App;
