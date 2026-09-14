import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { LlmMetrics, LlmBenchTarget } from "../../api/types";
import { setLlmApiKey, updateLlmPort, updateLlmPorts } from "../../api/client";
import { Sparkline } from "../ui/Sparkline";
import { Panel } from "../ui/Panel";
import { BotIcon, GearIcon, InfoIcon } from "../ui/icons";
import {
  useMetricsHistory,
  useMetricsHistoryTail,
  avgPositive,
} from "../../hooks/metricsStore";
import { BenchmarkDialog } from "./BenchmarkDialog";
import { PrefillBenchDialog } from "./PrefillBenchDialog";
import { LlmDailyChart } from "./LlmDailyChart";
import { parseLlmTargetInput } from "../../shared/llmTarget.js";
import { LlmTrendChart } from "./LlmTrendChart";

interface LlmPanelProps {
  llm: LlmMetrics | null;
  sparkId: string;
  llmPort: number;
  llmPorts?: number[];
  hasApiKey?: boolean;
  onRemovePort?: (port: number) => void;
  className?: string;
}

const VLLM_METRIC_INFO = {
  kvCache:
    "引擎当前 KV 缓存占用比例（0–100%）。较高占用（≥80%）意味着新请求或长上下文余量较少，可能出现排队或抢占。",
  requests:
    "运行：正在 GPU 上生成的请求。排队：已接受但尚未调度的请求。排队增长且 KV 缓存占用较高时，通常表示容量紧张。",
  ttftP95:
    "引擎请求历史中的首 Token 延迟 P95。上升可能来自排队、长预填充或冷启动路径，不等于平均解码速度下降。",
  preempts:
    "引擎为释放 KV 缓存而暂停运行请求的累计次数。负载期间增长提示内存压力；零表示尚未观测到此类抢占。",
  prefixCache:
    "启动以来前缀缓存命中数 / 查询数。较高值表示提示词复用较多、预填充计算较少；缺少指标或尚未使用时不提供数值。",
  e2eP95:
    "引擎请求历史中的端到端延迟 P95，从请求到达到完成，包含排队、预填充和解码，不仅是 Token 生成时间。",
  itlP95:
    "引擎历史中相邻输出 Token 间隔的 P95。上升可能表示解码停顿或资源争用，较低值通常表示流式输出更平滑。",
  mtpAccept:
    "启动以来推测解码 / MTP 接受的草稿 Token 数占草稿总数的比例。未启用或尚未使用时不提供数值。",
} as const;

const LAUNCHER_BTN =
  "rounded border border-border bg-surface-elevated px-3 py-1.5 text-xs font-medium text-text transition-colors hover:border-accent hover:bg-accent-soft";
const REMOTE_STORAGE_KEY = "sparkdash.remote-bench-target";

function readStoredRemote(): { host: string; port: string; tls: boolean } {
  try {
    const raw = localStorage.getItem(REMOTE_STORAGE_KEY);
    if (!raw) return { host: "", port: "443", tls: true };
    const v = JSON.parse(raw) as { host?: string; port?: number; tls?: boolean };
    return {
      host: typeof v.host === "string" ? v.host : "",
      port: v.port != null ? String(v.port) : "443",
      tls: v.tls !== false,
    };
  } catch {
    return { host: "", port: "443", tls: true };
  }
}

/** Decode / prefill / Showcase launchers — shown even when the live probe is empty
 *  (remote loopback-bound servers can still be benched via SSH tunnel). */
function LlmLaunchers({
  sparkId,
  llmPort,
  modelId,
  onDecode,
  onPrefill,
  onRemoteDecode,
  onRemotePrefill,
}: {
  sparkId: string;
  llmPort: number;
  modelId?: string | null;
  onDecode: () => void;
  onPrefill: () => void;
  onRemoteDecode: (target: LlmBenchTarget) => void;
  onRemotePrefill: (target: LlmBenchTarget) => void;
}) {
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [hostDraft, setHostDraft] = useState(() => readStoredRemote().host);
  const [portDraft, setPortDraft] = useState(() => readStoredRemote().port);
  const [tls, setTls] = useState(() => readStoredRemote().tls);
  const [remoteError, setRemoteError] = useState<string | null>(null);

  const persist = (t: LlmBenchTarget) => {
    try {
      localStorage.setItem(REMOTE_STORAGE_KEY, JSON.stringify(t));
    } catch {
      /* ignore */
    }
  };

  const applyHostBlur = () => {
    if (!hostDraft.trim()) return;
    try {
      const p = parseLlmTargetInput(hostDraft, portDraft, tls);
      setHostDraft(p.host);
      setPortDraft(String(p.port));
      setTls(p.tls);
      setRemoteError(null);
    } catch {
      /* leave as typed until Run */
    }
  };

  const launchRemote = (kind: "decode" | "prefill") => {
    try {
      const p = parseLlmTargetInput(hostDraft, portDraft, tls);
      persist(p);
      setHostDraft(p.host);
      setPortDraft(String(p.port));
      setTls(p.tls);
      setRemoteError(null);
      if (kind === "decode") onRemoteDecode(p);
      else onRemotePrefill(p);
    } catch (err: unknown) {
      setRemoteError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="border-t border-border pt-3 space-y-2">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onDecode}
          className={`${LAUNCHER_BTN} min-w-0 flex-1`}
          title="测试此节点的模型服务；远程节点使用局域网 HTTP，服务仅监听 127.0.0.1 时使用 SSH 隧道。"
        >
          运行解码基准测试
        </button>
        <button
          type="button"
          onClick={() => {
            setRemoteOpen((v) => !v);
            setRemoteError(null);
          }}
          className={`shrink-0 rounded border px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wide transition-colors ${
            remoteOpen
              ? "border-accent bg-accent-soft text-accent"
              : "border-border bg-surface-elevated text-muted hover:border-accent hover:text-accent"
          }`}
          aria-expanded={remoteOpen}
          title="对指定主机执行按需测试（HTTPS Tailscale、局域网 IP 等）；点击运行前不会探测。"
        >
          远程
        </button>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onPrefill}
          className={`${LAUNCHER_BTN} min-w-0 flex-1`}
          title="测试此节点的模型服务；远程节点使用局域网 HTTP，服务仅监听 127.0.0.1 时使用 SSH 隧道。"
        >
          运行预填充基准测试
        </button>
        <button
          type="button"
          onClick={() => {
            setRemoteOpen((v) => !v);
            setRemoteError(null);
          }}
          className={`shrink-0 rounded border px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wide transition-colors ${
            remoteOpen
              ? "border-accent bg-accent-soft text-accent"
              : "border-border bg-surface-elevated text-muted hover:border-accent hover:text-accent"
          }`}
          aria-expanded={remoteOpen}
          title="对指定主机执行按需测试（HTTPS Tailscale、局域网 IP 等）；点击运行前不会探测。"
        >
          远程
        </button>
      </div>
      {remoteOpen && (
        <div className="space-y-2 rounded border border-border bg-surface-elevated p-2">
          <p className="text-[10px] leading-snug text-muted">
            按需测试目标：粘贴 URL 或填写主机与端口，点击运行前不会探测。
          </p>
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wide text-muted">主机</span>
            <input
              type="text"
              value={hostDraft}
              onChange={(e) => setHostDraft(e.target.value)}
              onBlur={applyHostBlur}
              placeholder="https://name.tailxxxxx.ts.net/v1/models"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className="w-full rounded-md border border-border bg-surface px-2 py-1.5 font-tabular text-xs text-text outline-none focus:border-accent"
            />
          </label>
          <div className="flex items-end gap-2">
            <label className="min-w-0 flex-1 space-y-1">
              <span className="text-[10px] uppercase tracking-wide text-muted">端口</span>
              <input
                type="number"
                min={1}
                max={65535}
                inputMode="numeric"
                value={portDraft}
                onChange={(e) => setPortDraft(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-2 py-1.5 font-tabular text-xs text-text outline-none focus:border-accent"
              />
            </label>
            <label className="flex shrink-0 items-center gap-1.5 pb-1.5 text-[10px] text-muted">
              <input
                type="checkbox"
                checked={tls}
                onChange={(e) => {
                  const next = e.target.checked;
                  setTls(next);
                  if (next && portDraft === "8888") setPortDraft("443");
                  if (!next && portDraft === "443") setPortDraft("8888");
                }}
                className="h-3.5 w-3.5 accent-[var(--color-accent)]"
              />
              HTTPS
            </label>
          </div>
          {remoteError && <p className="text-[10px] text-danger">{remoteError}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => launchRemote("decode")}
              className={`${LAUNCHER_BTN} flex-1`}
            >
              解码
            </button>
            <button
              type="button"
              onClick={() => launchRemote("prefill")}
              className={`${LAUNCHER_BTN} flex-1`}
            >
              预填充
            </button>
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => {
          const params = new URLSearchParams();
          if (llmPort) params.set("port", String(llmPort));
          if (modelId) params.set("model", modelId);
          const q = params.toString() ? `?${params.toString()}` : "";
          window.open(
            `/showcase/${encodeURIComponent(sparkId)}${q}`,
            "_blank",
            "noopener,noreferrer"
          );
        }}
        className={`${LAUNCHER_BTN} w-full`}
      >
        演示
      </button>
    </div>
  );
}

/** Backend badge — neutral surfaces with a single accent dot. No blue/purple. */
function BackendBadge({ backend }: { backend: string | null }) {
  if (!backend) return <span className="text-xs text-muted">无后端</span>;

  const labels: Record<string, string> = {
    vllm: "vLLM",
    "llama.cpp": "llama.cpp",
    sglang: "sgLang",
    ds4: "ds4",
    exl3: "EXL3",
    q27: "q27",
  };

  return (
    <span className="llm-badge">
      <span className="h-1.5 w-1.5 rounded-full bg-data" />
      {labels[backend] || backend}
    </span>
  );
}

/** Exposure / auth posture from the unauthenticated probe (issue #17). */
function postureLabel(label: string): string {
  const labels: Record<string,string> = {'API key · Local':'API 密钥 · 本机','Auth required':'需要鉴权','Local':'本机','Open · Local':'开放 · 本机','API key':'API 密钥'};
  return labels[label] ?? label;
}

function PostureBadge({
  posture,
}: {
  posture: NonNullable<LlmMetrics["posture"]>;
}) {
  return (
    <span
      className={`llm-posture llm-posture--${posture.level}`}
      title={posture.detail}
    >
      <span className="llm-posture__dot" />
      {postureLabel(posture.label)}
    </span>
  );
}

/** Small (i) next to a metric label; one open tooltip at a time. */
function MetricInfoTip({
  id,
  label,
  text,
  openId,
  setOpenId,
  /** Anchor tooltip to the right so edge columns don’t clip off-screen */
  align = "left",
}: {
  id: string;
  label: string;
  text: string;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  align?: "left" | "right";
}) {
  const open = openId === id;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current != null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    clearTimer();
    timer.current = setTimeout(() => setOpenId(null), 2000);
  }, [clearTimer, setOpenId]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  return (
    <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted">
      <span>{label}</span>
      <button
        type="button"
        onClick={() => {
          if (open) {
            clearTimer();
            setOpenId(null);
          } else {
            setOpenId(id);
            scheduleClose();
          }
        }}
        onMouseEnter={() => {
          clearTimer();
          setOpenId(id);
        }}
        onMouseLeave={scheduleClose}
        className="relative cursor-pointer opacity-60 hover:opacity-100"
        aria-label={`${label} info`}
      >
        <InfoIcon className="h-2.5 w-2.5" />
        {open && (
          <div
            onMouseEnter={clearTimer}
            onMouseLeave={scheduleClose}
            className={`absolute top-full z-20 mt-1 w-52 max-w-[min(13rem,calc(100vw-1.5rem))] rounded-md border border-border bg-surface-elevated px-3 py-2 text-left text-[11px] font-normal normal-case leading-snug text-text shadow-lg ${
              align === "right" ? "right-0 left-auto" : "left-0 right-auto"
            }`}
          >
            {text}
          </div>
        )}
      </button>
    </div>
  );
}

export function LlmPanel({
  llm,
  sparkId,
  llmPort,
  llmPorts,
  hasApiKey = false,
  onRemovePort,
  className,
}: LlmPanelProps) {
  // Tail keyed by port so multi-port LLM sparklines stay distinct (8b).
  const genHistory = useMetricsHistoryTail(sparkId, `llm:${llmPort}.tps`);
  const prefillHistory = useMetricsHistoryTail(sparkId, `llm:${llmPort}.prefill`);
  const cachedPrefillHistory = useMetricsHistoryTail(sparkId, `llm:${llmPort}.prefillCached`);
  const uncachedPrefillHistory = useMetricsHistoryTail(sparkId, `llm:${llmPort}.prefillUncached`);

  // Full series (~1 h) for running averages over busy (>0) samples only.
  const genFull = useMetricsHistory(sparkId, `llm:${llmPort}.tps`);
  const prefillFull = useMetricsHistory(sparkId, `llm:${llmPort}.prefill`);
  const cachedFull = useMetricsHistory(sparkId, `llm:${llmPort}.prefillCached`);
  const uncachedFull = useMetricsHistory(sparkId, `llm:${llmPort}.prefillUncached`);
  const genAvg = useMemo(() => avgPositive(genFull), [genFull]);
  const prefillAvg = useMemo(() => avgPositive(prefillFull), [prefillFull]);
  const cachedPrefillAvg = useMemo(() => avgPositive(cachedFull), [cachedFull]);
  const uncachedPrefillAvg = useMemo(() => avgPositive(uncachedFull), [uncachedFull]);
  const [showSettings, setShowSettings] = useState(false);
  const [portDraft, setPortDraft] = useState(String(llmPort));
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [engineInfoOpen, setEngineInfoOpen] = useState(false);
  const [benchOpen, setBenchOpen] = useState(false);
  const [prefillBenchOpen, setPrefillBenchOpen] = useState(false);
  const [remoteTarget, setRemoteTarget] = useState<LlmBenchTarget | null>(null);
  const openRemoteDecode = useCallback((target: LlmBenchTarget) => {
    setRemoteTarget(target);
    setBenchOpen(true);
  }, []);
  const openRemotePrefill = useCallback((target: LlmBenchTarget) => {
    setRemoteTarget(target);
    setPrefillBenchOpen(true);
  }, []);
  const openLocalDecode = useCallback(() => {
    setRemoteTarget(null);
    setBenchOpen(true);
  }, []);
  const openLocalPrefill = useCallback(() => {
    setRemoteTarget(null);
    setPrefillBenchOpen(true);
  }, []);
  /** Which vLLM metric info tip is open (kvCache | requests | ttftP95 | preempts). */
  const [metricInfoId, setMetricInfoId] = useState<string | null>(null);
  const engineInfoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearEngineInfoTimer = useCallback(() => {
    if (engineInfoTimer.current != null) {
      clearTimeout(engineInfoTimer.current);
      engineInfoTimer.current = null;
    }
  }, []);

  const startEngineInfoTimer = useCallback(() => {
    clearEngineInfoTimer();
    engineInfoTimer.current = setTimeout(() => setEngineInfoOpen(false), 2000);
  }, [clearEngineInfoTimer]);

  const generationTps = llm?.generationTps ?? 0;
  const prefillTps = llm?.prefillTps ?? 0;
  const showPrefillSplit = llm?.cachedPrefillTps != null || llm?.uncachedPrefillTps != null;
  const cachedPrefillTps = llm?.cachedPrefillTps ?? 0;
  const uncachedPrefillTps = llm?.uncachedPrefillTps ?? 0;
  const available = llm?.available ?? false;

  // Keep draft in sync when server pushes a different port (other tab / reload)
  useEffect(() => {
    if (!showSettings) {
      setPortDraft(String(llmPort));
      setApiKeyDraft("");
      setClearApiKey(false);
    }
  }, [llmPort, showSettings]);

  const parsedPort = (() => {
    const n = parseInt(portDraft, 10);
    if (!Number.isInteger(n) || n < 1 || n > 65535) return null;
    return n;
  })();

  const portDirty = parsedPort !== null && parsedPort !== llmPort;
  const portInvalid = portDraft.trim() !== "" && parsedPort === null;
  const apiKeyDirty = apiKeyDraft.trim() !== "" || clearApiKey;
  const settingsDirty = portDirty || apiKeyDirty;

  const handleSaveSettings = async () => {
    if (parsedPort === null) {
      setSaveError("端口必须是 1–65535 之间的整数");
      return;
    }
    if (!settingsDirty) {
      setShowSettings(false);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      if (portDirty) {
        const currentPorts =
          Array.isArray(llmPorts) && llmPorts.length > 0 ? llmPorts : [llmPort];
        if (currentPorts.includes(parsedPort) && parsedPort !== llmPort) {
          setSaveError(`端口 ${parsedPort} 已配置`);
          setSaving(false);
          return;
        }
        // Rename this panel's port in-place so sibling ports (and their keys) survive
        if (currentPorts.length > 1) {
          const next = currentPorts.map((p) => (p === llmPort ? parsedPort : p));
          await updateLlmPorts(sparkId, next);
        } else {
          await updateLlmPort(sparkId, parsedPort);
        }
      }
      const keyPort = parsedPort;
      if (clearApiKey) {
        await setLlmApiKey(sparkId, keyPort, "");
      } else if (apiKeyDraft.trim() !== "") {
        await setLlmApiKey(sparkId, keyPort, apiKeyDraft.trim());
      }
      setApiKeyDraft("");
      setClearApiKey(false);
      setShowSettings(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "无法保存模型设置");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel
      title="LLM"
      accent={available}
      icon={<BotIcon />}
      className={`panel-llm ${className}`}
      actions={
        <div className="flex items-center gap-1.5">
          {onRemovePort && (
            <button
              type="button"
              title={`Remove port ${llmPort}`}
              onClick={() => onRemovePort(llmPort)}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-danger transition-colors hover:bg-danger/10"
            >
              <span aria-hidden>×</span>
              <span>移除</span>
            </button>
          )}
          <button
            type="button"
            title={showSettings ? "完成" : "LLM 设置"}
            onClick={() => {
              if (showSettings) {
                setPortDraft(String(llmPort));
                setApiKeyDraft("");
                setClearApiKey(false);
                setSaveError(null);
              }
              setShowSettings(!showSettings);
            }}
            disabled={saving}
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted transition-colors hover:bg-surface-hover disabled:opacity-50 ${
              showSettings ? "bg-surface-elevated text-text" : ""
            }`}
          >
            <GearIcon />
            <span>{showSettings ? "完成" : "设置"}</span>
          </button>
        </div>
      }
    >
      {showSettings ? (
        <div className="space-y-3">
          <p className="text-[10px] text-muted">
            此节点模型服务的 HTTP 端口（vLLM / llama.cpp / sglang / ds4 / EXL3 / OpenAI 兼容网关）。
          </p>
          <label className="block space-y-1">
            <span className="text-xs text-muted">端口</span>
            <input
              type="number"
              min={1}
              max={65535}
              inputMode="numeric"
              value={portDraft}
              onChange={(e) => {
                setPortDraft(e.target.value);
                setSaveError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleSaveSettings();
                }
              }}
              className="w-full rounded-md border border-border bg-surface-elevated px-3 py-1.5 font-tabular text-sm text-text outline-none focus:border-accent"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted">API 密钥（可选）</span>
            <input
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              value={apiKeyDraft}
              disabled={clearApiKey}
              placeholder={hasApiKey && !clearApiKey ? "••••••••（已保存，留空保留）" : "如有需要，请输入 Bearer 令牌"}
              onChange={(e) => {
                setApiKeyDraft(e.target.value);
                setClearApiKey(false);
                setSaveError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleSaveSettings();
                }
              }}
              className="w-full rounded-md border border-border bg-surface-elevated px-3 py-1.5 font-mono text-sm text-text outline-none focus:border-accent disabled:opacity-50"
            />
          </label>
          {hasApiKey && (
            <label className="flex cursor-pointer items-center gap-2 text-[11px] text-muted">
              <input
                type="checkbox"
                checked={clearApiKey}
                onChange={(e) => {
                  setClearApiKey(e.target.checked);
                  if (e.target.checked) setApiKeyDraft("");
                  setSaveError(null);
                }}
                className="h-3.5 w-3.5 accent-[var(--color-accent)]"
              />
              清除已保存的 API 密钥
            </label>
          )}
          {portInvalid && (
            <p className="text-[10px] text-danger">请输入 1 到 65535 之间的整数</p>
          )}
          {saveError && <p className="text-[10px] text-danger">{saveError}</p>}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setPortDraft(String(llmPort));
                setApiKeyDraft("");
                setClearApiKey(false);
                setSaveError(null);
                setShowSettings(false);
              }}
              disabled={saving}
              className="rounded border border-border px-2 py-1 text-[10px] text-muted hover:bg-surface-hover disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void handleSaveSettings()}
              disabled={saving || portInvalid || !settingsDirty}
              className="rounded bg-accent px-2 py-1 text-[10px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {saving ? "正在保存…" : "保存"}
            </button>
          </div>
        </div>
      ) : !available ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 py-1">
            {llm?.posture ? (
              <PostureBadge posture={llm.posture} />
            ) : (
              <span className="h-1.5 w-1.5 rounded-full bg-muted" />
            )}
            <p className="text-xs text-muted">
              {llm?.posture?.auth === "protected"
                ? `${postureLabel(llm.posture.label)} · 端口 ${llmPort}`
                : `端口 ${llmPort} 未加载模型`}
            </p>
          </div>
          <LlmLaunchers
            sparkId={sparkId}
            llmPort={llmPort}
            modelId={llm?.modelId}
            onDecode={openLocalDecode}
            onPrefill={openLocalPrefill}
            onRemoteDecode={openRemoteDecode}
            onRemotePrefill={openRemotePrefill}
          />
          <LlmDailyChart sparkId={sparkId} llmPort={llmPort} />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <BackendBadge backend={llm?.backend ?? null} />
            {llm?.posture && <PostureBadge posture={llm.posture} />}
            {llm?.modelId && (
              <span
                className="min-w-0 flex-1 whitespace-normal break-words text-xs leading-snug text-text [overflow-wrap:anywhere]"
                title={llm.modelId}
              >
                {llm.modelId}
              </span>
            )}
            <span className="shrink-0 font-tabular text-[10px] text-muted">:{llmPort}</span>
          </div>
          {llm?.modelPath &&
            llm.modelPath !== llm.modelId &&
            !llm.modelPath.includes("models--") && (
            <div className="-mt-1.5 truncate text-[10px] text-muted" title={llm.modelPath}>
              {llm.modelPath}
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">生成 tok/s</span>
            <div className="flex items-center gap-2">
              <Sparkline data={genHistory} color="var(--color-data)" height={24} />
              <div className="text-right">
                <div className="font-tabular text-sm font-semibold text-text-strong">
                  {generationTps.toFixed(1)}
                </div>
                {genAvg != null && (
                  <div className="font-tabular text-[9px] text-muted">
                    平均 {genAvg >= 100 ? genAvg.toFixed(0) : genAvg.toFixed(1)}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div
            className="flex items-center justify-between"
            title="首个输出 Token 之前，模型读取提示词并建立 KV 缓存的吞吐量。仅打开历史聊天不会触发 GPU 计算；发送或重新生成才会提交提示词。前缀缓存命中时计算较少，数值可能接近零；较长的冷预填充会持续显示，直到开始解码。"
          >
            <span className="text-xs text-muted">预填充 tok/s</span>
            <div className="flex items-center gap-2">
              <Sparkline data={prefillHistory} color="var(--color-text)" height={24} />
              <div className="text-right">
                <div className="font-tabular text-sm font-semibold text-text">
                  {prefillTps.toFixed(1)}
                </div>
                {prefillAvg != null && (
                  <div className="font-tabular text-[9px] text-muted">
                    平均 {prefillAvg >= 100 ? prefillAvg.toFixed(0) : prefillAvg.toFixed(1)}
                  </div>
                )}
              </div>
            </div>
          </div>
          {showPrefillSplit && (
            <>
              <div
                className="flex items-center justify-between"
                title="来自前缀缓存的预填充 Token，GPU 计算较少；较高数值代表提示词复用，不代表冷预填充更快。"
              >
                <span className="text-xs text-muted">缓存预填充 tok/s</span>
                <div className="flex items-center gap-2">
                  <Sparkline data={cachedPrefillHistory} color="var(--color-muted)" height={24} />
                  <div className="text-right">
                    <div className="font-tabular text-sm font-semibold text-muted">
                      {cachedPrefillTps.toFixed(1)}
                    </div>
                    {cachedPrefillAvg != null && (
                      <div className="font-tabular text-[9px] text-muted">
                        平均 {cachedPrefillAvg >= 100 ? cachedPrefillAvg.toFixed(0) : cachedPrefillAvg.toFixed(1)}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div
                className="flex items-center justify-between"
                title="未缓存预填充：实际在 GPU 上计算并建立 KV 缓存的 Token。"
              >
                <span className="text-xs text-muted">未缓存预填充 tok/s</span>
                <div className="flex items-center gap-2">
                  <Sparkline data={uncachedPrefillHistory} color="var(--color-text)" height={24} />
                  <div className="text-right">
                    <div className="font-tabular text-sm font-semibold text-text">
                      {uncachedPrefillTps.toFixed(1)}
                    </div>
                    {uncachedPrefillAvg != null && (
                      <div className="font-tabular text-[9px] text-muted">
                        平均 {uncachedPrefillAvg >= 100 ? uncachedPrefillAvg.toFixed(0) : uncachedPrefillAvg.toFixed(1)}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}

          <LlmTrendChart sparkId={sparkId} llmPort={llmPort} />
          <LlmDailyChart sparkId={sparkId} llmPort={llmPort} />

          <div className="grid grid-cols-4 gap-2 border-t border-border pt-3">
            <div className="space-y-0.5">
              <div className="text-[10px] uppercase tracking-wide text-muted">槽位</div>
              <div className="font-tabular text-sm text-text">
                {(llm?.slotsTotal ?? 0) > 0
                  ? `${llm?.slotsActive ?? 0} / ${llm?.slotsTotal ?? 0}`
                  : (llm?.slotsActive ?? 0) > 0
                    ? `${llm?.slotsActive} running`
                    : "—"}
              </div>
            </div>
            <div className="space-y-0.5">
              <div className="text-[10px] uppercase tracking-wide text-muted">上下文</div>
              <div className="font-tabular text-sm text-text">
                {llm?.contextLength ? llm.contextLength.toLocaleString() : "—"}
              </div>
            </div>
            <div className="space-y-0.5">
              <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted">
                <span>引擎</span>
                <button
                  type="button"
                  onClick={() => {
                    setEngineInfoOpen((v) => {
                      if (!v) startEngineInfoTimer();
                      return !v;
                    });
                  }}
                  onMouseEnter={clearEngineInfoTimer}
                  onMouseLeave={startEngineInfoTimer}
                  className="relative cursor-pointer opacity-60 hover:opacity-100"
                  aria-label="引擎状态说明"
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 16v-4" />
                    <path d="M12 8h.01" />
                  </svg>
                  {engineInfoOpen && (
                    <div
                      onMouseEnter={clearEngineInfoTimer}
                      onMouseLeave={startEngineInfoTimer}
                      className="absolute left-0 top-full z-10 mt-1 w-56 rounded-md border border-border bg-surface-elevated px-3 py-2 text-left text-[11px] font-normal normal-case text-text shadow-lg"
                    >
                      活跃：正在处理或可接受请求。休眠：当前空闲，GPU 内存已释放，等待下次请求。
                    </div>
                  )}
                </button>
              </div>
              <div className="font-tabular text-sm text-text">
                {llm?.gpuMemoryUtilization != null
                  ? llm.gpuMemoryUtilization === 0
                    ? "休眠"
                    : "活跃"
                  : "—"}
              </div>
            </div>
            <div className="space-y-0.5">
              <div className="text-[10px] uppercase tracking-wide text-muted">累计生成</div>
              <div className="font-tabular text-sm text-text">
                {llm && llm.totalOutputTokens > 0
                  ? llm.totalOutputTokens.toLocaleString()
                  : "—"}
              </div>
            </div>
          </div>

          {llm && (llm.backend === "vllm" || llm.backend === "q27") && (
            <div className="grid grid-cols-2 gap-2 border-t border-border pt-3 sm:grid-cols-4">
              <div className="space-y-0.5">
                <MetricInfoTip
                  id="kvCache"
                  label="KV 缓存"
                  text={VLLM_METRIC_INFO.kvCache}
                  openId={metricInfoId}
                  setOpenId={setMetricInfoId}
                />
                <div
                  className={`font-tabular text-sm ${
                    llm.kvCacheUsage == null
                      ? "text-text"
                      : llm.kvCacheUsage >= 0.8
                        ? "text-danger"
                        : llm.kvCacheUsage >= 0.5
                          ? "text-warning"
                          : "text-success"
                  }`}
                >
                  {llm.kvCacheUsage != null
                    ? `${(llm.kvCacheUsage * 100).toFixed(1)}%`
                    : "—"}
                </div>
              </div>
              <div className="space-y-0.5">
                <MetricInfoTip
                  id="requests"
                  label="请求"
                  text={VLLM_METRIC_INFO.requests}
                  openId={metricInfoId}
                  setOpenId={setMetricInfoId}
                  align="right"
                />
                <div className="font-tabular text-sm text-text">
                  {llm.requestsRunning != null
                    ? `${Math.round(llm.requestsRunning)} run${
                        llm.requestsWaiting != null
                          ? ` / ${Math.round(llm.requestsWaiting)} wait`
                          : ""
                      }`
                    : "—"}
                </div>
              </div>
              <div className="space-y-0.5">
                <MetricInfoTip
                  id="ttftP95"
                  label="首字延迟 P95"
                  text={VLLM_METRIC_INFO.ttftP95}
                  openId={metricInfoId}
                  setOpenId={setMetricInfoId}
                />
                <div className="font-tabular text-sm text-text">
                  {llm.ttftP95Seconds != null ? `${llm.ttftP95Seconds.toFixed(3)}s` : "—"}
                </div>
              </div>
              <div className="space-y-0.5">
                <MetricInfoTip
                  id="preempts"
                  label="抢占次数"
                  text={VLLM_METRIC_INFO.preempts}
                  openId={metricInfoId}
                  setOpenId={setMetricInfoId}
                  align="right"
                />
                <div className="font-tabular text-sm text-text">
                  {llm.preemptionsTotal != null
                    ? Math.round(llm.preemptionsTotal).toLocaleString()
                    : "—"}
                </div>
              </div>
            </div>
          )}

          {llm && (llm.backend === "vllm" || llm.backend === "q27") && (
            <div className="grid grid-cols-2 gap-2 border-t border-border pt-3 sm:grid-cols-4">
              <div className="space-y-0.5">
                <MetricInfoTip
                  id="prefixCache"
                  label="前缀缓存"
                  text={VLLM_METRIC_INFO.prefixCache}
                  openId={metricInfoId}
                  setOpenId={setMetricInfoId}
                />
                <div className="font-tabular text-sm text-text">
                  {llm.prefixCacheHitRate != null
                    ? `${(llm.prefixCacheHitRate * 100).toFixed(1)}%`
                    : "—"}
                </div>
              </div>
              <div className="space-y-0.5">
                <MetricInfoTip
                  id="e2eP95"
                  label="E2E p95"
                  text={VLLM_METRIC_INFO.e2eP95}
                  openId={metricInfoId}
                  setOpenId={setMetricInfoId}
                  align="right"
                />
                <div className="font-tabular text-sm text-text">
                  {llm.e2eP95Seconds != null ? `${llm.e2eP95Seconds.toFixed(3)}s` : "—"}
                </div>
              </div>
              <div className="space-y-0.5">
                <MetricInfoTip
                  id="itlP95"
                  label="字间延迟 P95"
                  text={VLLM_METRIC_INFO.itlP95}
                  openId={metricInfoId}
                  setOpenId={setMetricInfoId}
                />
                <div className="font-tabular text-sm text-text">
                  {llm.itlP95Seconds != null ? `${llm.itlP95Seconds.toFixed(3)}s` : "—"}
                </div>
              </div>
              <div className="space-y-0.5">
                <MetricInfoTip
                  id="mtpAccept"
                  label="MTP 接受率"
                  text={VLLM_METRIC_INFO.mtpAccept}
                  openId={metricInfoId}
                  setOpenId={setMetricInfoId}
                  align="right"
                />
                <div className="font-tabular text-sm text-text">
                  {llm.mtpAcceptanceRate != null
                    ? `${(llm.mtpAcceptanceRate * 100).toFixed(1)}%`
                    : "—"}
                </div>
              </div>
            </div>
          )}

          <LlmLaunchers
            sparkId={sparkId}
            llmPort={llmPort}
            modelId={llm?.modelId}
            onDecode={openLocalDecode}
            onPrefill={openLocalPrefill}
            onRemoteDecode={openRemoteDecode}
            onRemotePrefill={openRemotePrefill}
          />
        </div>
      )}

      <BenchmarkDialog
        open={benchOpen}
        onClose={() => setBenchOpen(false)}
        sparkId={sparkId}
        llmPort={llmPort}
        modelId={remoteTarget ? null : llm?.modelId ?? null}
        remoteTarget={remoteTarget}
      />
      <PrefillBenchDialog
        open={prefillBenchOpen}
        onClose={() => setPrefillBenchOpen(false)}
        sparkId={sparkId}
        llmPort={llmPort}
        modelId={remoteTarget ? null : llm?.modelId ?? null}
        contextLength={remoteTarget ? null : llm?.contextLength ?? null}
        remoteTarget={remoteTarget}
      />
    </Panel>
  );
}
