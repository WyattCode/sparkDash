import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  cancelShowcaseOnUnload,
  cancelShowcase,
  clearShowcaseHistory,
  fetchSparkMetrics,
  fetchSparks,
  getShowcase,
  listShowcase,
  startShowcase,
} from "../../api/client";
import type {
  ShowcaseHistorySummary,
  ShowcaseSessionState,
  SparkConfig,
} from "../../api/types";
import { isLlmMonitoringEnabled } from "../../api/sparkRole";
import { BoltIcon } from "../ui/icons";
import { TerminalCard } from "./TerminalCard";
import { ThemeSwitch } from '../ThemeSwitch';
import { checkShowcaseAvailability, useShowcaseAvailability } from '../../hooks/useShowcaseAvailability';
import {
  PROMPT_TYPES,
  pickShowcasePrompts,
  type ShowcasePromptType,
} from "./showcasePrompts";

const POLL_MS = 300;
const DEFAULT_MAX_TOKENS = 512;
const DEFAULT_PROMPT_TYPE: ShowcasePromptType = "mixed";
const DEFAULT_TEMPERATURE = 0.7;
const MIN_TEMPERATURE = 0;
const MAX_TEMPERATURE = 2;
const MIN_TERMINALS = 1;
const MAX_TERMINALS = 32;
const TERMINAL_COUNTS = Array.from(
  { length: MAX_TERMINALS - MIN_TERMINALS + 1 },
  (_, i) => i + MIN_TERMINALS
);

/**
 * Choose a column count that fills the viewport grid with few empty cells
 * and a near-square shape (e.g. 4→2×2, 9→3×3, 8→4×2).
 */
function optimalGridCols(n: number): number {
  const count = Math.max(1, Math.min(MAX_TERMINALS, Math.floor(n)));
  if (count <= 1) return 1;
  if (count === 2) return 2;
  if (count === 3) return 3;
  if (count === 4) return 2;

  const maxCols = Math.min(8, count);
  const ideal = Math.sqrt(count);
  let bestCols = Math.min(maxCols, Math.max(1, Math.round(ideal)));
  let bestScore = Number.POSITIVE_INFINITY;

  for (let cols = 1; cols <= maxCols; cols++) {
    const rows = Math.ceil(count / cols);
    const empty = cols * rows - count;
    const score =
      empty * 20 +
      (cols - ideal) ** 2 * 6 +
      (rows - ideal) ** 2 * 6 +
      (rows > cols ? 2 : 0);
    if (score < bestScore) {
      bestScore = score;
      bestCols = cols;
    }
  }
  return bestCols;
}

interface ShowcasePageProps {
  sparkId: string;
}

interface LocalStream {
  streamId: string;
  label: string;
  prompt: string;
  status: string;
  content: string;
  reasoning: string;
  tokenCount: number;
  ttftMs: number | null;
  decodeTps: number;
  liveTokPerSec: number;
  peakTokPerSec: number;
  error: string | null;
}

function readPortQuery(fallback: number): number {
  try {
    const q = new URLSearchParams(window.location.search).get("port");
    if (q == null || q === "") return fallback;
    const n = parseInt(q, 10);
    if (Number.isInteger(n) && n >= 1 && n <= 65535) return n;
  } catch {
    /* ignore */
  }
  return fallback;
}

function readModelQuery(): string | null {
  try {
    const q = new URLSearchParams(window.location.search).get("model");
    if (q == null || q === "") return null;
    const trimmed = q.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

function buildTerminalPlainText(s: LocalStream): string {
  const parts: string[] = [`## ${s.label || s.streamId}`, `status: ${s.status}`];
  if (s.liveTokPerSec > 0 || s.decodeTps > 0 || s.peakTokPerSec > 0) {
    const live = s.liveTokPerSec || s.decodeTps;
    parts.push(
      `tok/s: ${live > 0 ? live.toFixed(1) : "—"}` +
        (s.peakTokPerSec > 0 ? `  peak ${s.peakTokPerSec.toFixed(1)}` : "") +
        (s.ttftMs != null ? `  TTFT ${s.ttftMs.toFixed(0)}ms` : "")
    );
  }
  parts.push("");
  if (s.reasoning) {
    parts.push("### Thinking", s.reasoning, "");
  }
  if (s.content) {
    parts.push("### Answer", s.content);
  }
  if (s.error) {
    parts.push("", `[error] ${s.error}`);
  }
  return parts.join("\n").trimEnd();
}

function buildAllPlainText(
  streams: LocalStream[],
  meta: {
    name: string;
    port: number;
    modelId: string | null;
    serverTps: number | null;
    sessionAvgTps?: number | null;
  }
): string {
  const head = [
    `${meta.name} | prompt showcase`,
    `port ${meta.port}` +
      (meta.modelId ? `  ·  ${meta.modelId}` : "") +
      (meta.sessionAvgTps != null && meta.sessionAvgTps > 0
        ? `  · avg ${meta.sessionAvgTps.toFixed(0)} tok/s/stream`
        : "") +
      (meta.serverTps != null ? `  · server ${meta.serverTps.toFixed(0)} tok/s` : ""),
    "",
  ];
  return [...head, ...streams.map((s) => buildTerminalPlainText(s)), ""]
    .join("\n")
    .trimEnd();
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function ShowcasePage({ sparkId }: ShowcasePageProps) {
  const [spark, setSpark] = useState<SparkConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [promptType, setPromptType] = useState<ShowcasePromptType>(DEFAULT_PROMPT_TYPE);
  const [prompts, setPrompts] = useState<string[]>(() =>
    pickShowcasePrompts(DEFAULT_PROMPT_TYPE, 4)
  );
  const [terminalCount, setTerminalCount] = useState(4);
  const [port, setPort] = useState(8888);
  const [modelId, setModelId] = useState<string | null>(() => readModelQuery());
  const [maxTokens, setMaxTokens] = useState(DEFAULT_MAX_TOKENS);
  const [temperature, setTemperature] = useState(DEFAULT_TEMPERATURE);
  const [thinking, setThinking] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [barVisible, setBarVisible] = useState(true);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<string | null>(null);
  const [streams, setStreams] = useState<LocalStream[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [serverTps, setServerTps] = useState<number | null>(null);
  const [serverTpsMax, setServerTpsMax] = useState<number | null>(null);
  const [aggregatePeakTps, setAggregatePeakTps] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<ShowcaseHistorySummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [viewingHistory, setViewingHistory] = useState(false);

  const revRef = useRef<number | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const startingRef = useRef(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollEpoch = useRef(0);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = sessionStatus === "running";
  const controlsLocked = running || starting;
  const availability = useShowcaseAvailability(sparkId, Boolean(spark) && isLlmMonitoringEnabled(spark!) && !spark!.workerNode && !running);

  const llmPorts = useMemo(() => {
    if (!spark) return [8888];
    if (Array.isArray(spark.llmPorts) && spark.llmPorts.length) return spark.llmPorts;
    if (spark.llmPort) return [spark.llmPort];
    return [8888];
  }, [spark]);

  const canRun =
    Boolean(spark) &&
    isLlmMonitoringEnabled(spark!) &&
    !spark!.workerNode &&
    !controlsLocked && !availability.message;

  const displayStreams = useMemo(() => {
    // Keep finished-run results only while the stream count still matches selection.
    if (streams.length > 0 && streams.length === prompts.length) {
      return streams;
    }
    return prompts.map((p, i) => ({
      streamId: String(i),
      label: p.replace(/\s+/g, " ").trim().slice(0, 40),
      prompt: p,
      status: "pending",
      content: "",
      reasoning: "",
      tokenCount: 0,
      ttftMs: null,
      decodeTps: 0,
      liveTokPerSec: 0,
      peakTokPerSec: 0,
      error: null,
    }));
  }, [streams, prompts]);

  /** Sum of per-stream live (or final decode) tok/s — concurrent aggregate throughput. */
  const aggregateTps = useMemo(() => {
    return displayStreams.reduce((sum, s) => {
      const rate =
        s.liveTokPerSec > 0
          ? s.liveTokPerSec
          : s.status === "completed"
            ? s.decodeTps
            : 0;
      return sum + rate;
    }, 0);
  }, [displayStreams]);

  const totalTokens = useMemo(
    () => displayStreams.reduce((sum, s) => sum + (s.tokenCount || 0), 0),
    [displayStreams]
  );

  /** Mean final/live decode tok/s across active streams (session avg per terminal). */
  const sessionAvgTps = useMemo(() => {
    const rates = displayStreams
      .map((s) => {
        if (s.decodeTps > 0) return s.decodeTps;
        if (s.liveTokPerSec > 0) return s.liveTokPerSec;
        return 0;
      })
      .filter((r) => r > 0);
    if (!rates.length) return 0;
    return rates.reduce((sum, r) => sum + r, 0) / rates.length;
  }, [displayStreams]);

  const runFinished =
    sessionStatus != null &&
    sessionStatus !== "running" &&
    sessionStatus !== "pending";

  useEffect(() => {
    if (aggregateTps <= 0) return;
    setAggregatePeakTps((prev) => (aggregateTps > prev ? aggregateTps : prev));
  }, [aggregateTps]);

  useEffect(() => {
    let cancelled = false;
    fetchSparks()
      .then(({ sparks }) => {
        if (cancelled) return;
        const found = sparks.find((s) => s.id === sparkId) || null;
        if (!found) {
          setLoadError("找不到节点");
          setSpark(null);
          return;
        }
        setSpark(found);
        setLoadError(null);
        const ports =
          Array.isArray(found.llmPorts) && found.llmPorts.length
            ? found.llmPorts
            : found.llmPort
              ? [found.llmPort]
              : [8888];
        setPort(readPortQuery(ports[0]));
        const fromQuery = readModelQuery();
        if (fromQuery) setModelId(fromQuery);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err?.message || "无法加载节点");
      });
    return () => {
      cancelled = true;
    };
  }, [sparkId]);

  useEffect(() => {
    if (!sparkId || !spark) return;
    let cancelled = false;
    const ports =
      Array.isArray(spark.llmPorts) && spark.llmPorts.length
        ? spark.llmPorts
        : spark.llmPort
          ? [spark.llmPort]
          : [8888];
    fetchSparkMetrics(sparkId)
      .then((snap) => {
        if (cancelled) return;
        const llmList = Array.isArray(snap?.metrics?.llm) ? snap.metrics.llm : [];
        const portIndex = ports.indexOf(port);
        const llm =
          (portIndex >= 0 ? llmList[portIndex] : null) ||
          llmList.find((m) => m?.available && m?.modelId) ||
          llmList[0];
        const id = llm?.modelId?.trim() || null;
        if (id) setModelId(id);
      })
      .catch(() => {
        /* keep query / prior modelId */
      });
    return () => {
      cancelled = true;
    };
  }, [sparkId, spark, port]);

  const setTerminalCountSafe = useCallback(
    (n: number) => {
      setTerminalCount(n);
      if (!running && !starting) {
        // Preserve edited prompts; only fill new slots from the catalog.
        setPrompts((prev) => {
          const catalog = pickShowcasePrompts(promptType, n);
          return catalog.map((d, i) =>
            i < prev.length && prev[i] != null && prev[i] !== "" ? prev[i] : d
          );
        });
        setStreams([]);
        setViewingHistory(false);
      }
    },
    [running, starting, promptType]
  );

  const setPromptTypeSafe = useCallback(
    (t: ShowcasePromptType) => {
      setPromptType(t);
      if (!running && !starting) {
        setPrompts(pickShowcasePrompts(t, terminalCount));
        setStreams([]);
        setViewingHistory(false);
      }
    },
    [running, starting, terminalCount]
  );

  const stopPolling = useCallback(() => {
    ++pollEpoch.current;
    if (pollTimer.current != null) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const flashCopied = useCallback((id: string) => {
    setCopiedId(id);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopiedId(null), 1500);
  }, []);

  const handleCopyOne = useCallback(
    async (s: LocalStream) => {
      const ok = await copyText(buildTerminalPlainText(s));
      if (ok) flashCopied(s.streamId);
      else setRunError("无法复制到剪贴板");
    },
    [flashCopied]
  );

  const handleCopyAll = useCallback(async () => {
    if (!spark || !displayStreams.some((s) => s.content || s.reasoning || s.error)) {
      return;
    }
    const ok = await copyText(
      buildAllPlainText(displayStreams, {
        name: spark.name,
        port,
        modelId,
        serverTps,
        sessionAvgTps: runFinished ? sessionAvgTps : null,
      })
    );
    if (ok) flashCopied("all");
    else setRunError("无法复制到剪贴板");
  }, [spark, displayStreams, port, modelId, serverTps, runFinished, sessionAvgTps, flashCopied]);

  const applySession = useCallback((data: ShowcaseSessionState, full: boolean) => {
    setSessionStatus(data.status);
    revRef.current = data.rev;
    if (data.modelId) setModelId(data.modelId);
    else {
      const fromStream = data.streams.find((s) => s.model)?.model;
      if (fromStream) setModelId(fromStream);
    }
    if (data.serverGenerationTps != null) setServerTps(data.serverGenerationTps);
    if (data.serverGenerationTpsMax != null) setServerTpsMax(data.serverGenerationTpsMax);
    setStreams((prev) => {
      const byId = new Map(prev.map((s) => [s.streamId, s]));
      return data.streams.map((s) => {
        const old = byId.get(s.streamId);
        let content = old?.content ?? "";
        let reasoning = old?.reasoning ?? "";
        if (full || s.resetContent || s.content != null) {
          content = s.content ?? "";
        } else if (s.contentAppend) {
          content += s.contentAppend;
        }
        if (full || s.resetContent || s.reasoning != null) {
          reasoning = s.reasoning ?? "";
        } else if (s.reasoningAppend) {
          reasoning += s.reasoningAppend;
        }
        const live = s.liveTokPerSec || 0;
        const peak = Math.max(
          old?.peakTokPerSec ?? 0,
          s.peakTokPerSec ?? 0,
          live,
          s.decodeTps || 0
        );
        return {
          streamId: s.streamId,
          label: s.label,
          prompt: s.prompt,
          status: s.status,
          content,
          reasoning,
          tokenCount: s.tokenCount,
          ttftMs: s.ttftMs,
          decodeTps: s.decodeTps,
          liveTokPerSec: live,
          peakTokPerSec: peak,
          error: s.error,
        };
      });
    });
  }, []);

  const refreshHistory = useCallback(async () => {
    if (!sparkId) return;
    setHistoryLoading(true);
    try {
      const data = await listShowcase(sparkId);
      setHistory(data.history || []);
    } catch {
      /* ignore list failures in UI */
    } finally {
      setHistoryLoading(false);
    }
  }, [sparkId]);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  useEffect(() => {
    if (historyOpen) void refreshHistory();
  }, [historyOpen, refreshHistory]);

  useEffect(() => {
    if (runFinished) void refreshHistory();
  }, [runFinished, refreshHistory]);

  const pollOnce = useCallback(
    async (sid: string) => {
      const epoch = pollEpoch.current;
      const since = revRef.current;
      const data = await getShowcase(
        sparkId,
        sid,
        since != null ? { since } : undefined
      );
      if (sessionIdRef.current === sid && pollEpoch.current === epoch) applySession(data, since == null);
      return data;
    },
    [sparkId, applySession]
  );

  const schedulePoll = useCallback(
    (sid: string, delay = POLL_MS) => {
      stopPolling();
      const epoch = pollEpoch.current;
      pollTimer.current = setTimeout(() => {
        void (async () => {
          if (sessionIdRef.current !== sid || pollEpoch.current !== epoch) return;
          try {
            const data = await pollOnce(sid);
            if (sessionIdRef.current !== sid || pollEpoch.current !== epoch) return;
            setRunError(null);
            if (data.status === "running") {
              schedulePoll(sid);
            } else {
              stopPolling();
            }
          } catch (err) {
            if (sessionIdRef.current !== sid || pollEpoch.current !== epoch) return;
            if (err instanceof ApiError && err.status === 404) {
              setRunError('演示会话已不存在，保留已收到的内容；请检查历史记录。');
              setSessionStatus('unavailable');
              sessionIdRef.current = null;
              stopPolling();
            } else {
              setRunError(`${err instanceof Error ? err.message : String(err)} 正在自动重连，暂不重复启动。`);
              schedulePoll(sid, 1000);
            }
          }
        })();
      }, delay);
    },
    [pollOnce, stopPolling]
  );

  const handleStop = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    stopPolling();
    try {
      const data = await cancelShowcase(sparkId, sid);
      applySession(data, false);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err));
      if (sessionIdRef.current === sid) schedulePoll(sid, 1000);
    }
  }, [sparkId, applySession, stopPolling, schedulePoll]);

  const handleRun = useCallback(async () => {
    if (!canRun || startingRef.current) return;
    startingRef.current = true;
    setRunError(null);
    setStarting(true);
    try {
      const blocking = await checkShowcaseAvailability(sparkId);
      if (blocking) throw new Error(blocking);
      const trimmed = prompts.map((p) => p.trim()).filter(Boolean);
      if (trimmed.length < MIN_TERMINALS || trimmed.length > MAX_TERMINALS) {
        throw new Error(`请填写 ${MIN_TERMINALS} 到 ${MAX_TERMINALS} 条非空提示词`);
      }
      const started = await startShowcase(sparkId, {
        port,
        maxTokens,
        temperature,
        thinking,
        modelId: modelId || undefined,
        promptType,
        prompts: trimmed,
      });
      setViewingHistory(false);
      revRef.current = null;
      setStreams([]);
      setServerTps(null);
      setServerTpsMax(null);
      setAggregatePeakTps(0);
      sessionIdRef.current = started.sessionId;
      setSessionId(started.sessionId);
      setSessionStatus("running");
      setConfigOpen(false);
      setHistoryOpen(false);
      schedulePoll(started.sessionId);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err));
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }, [
    canRun,
    prompts,
    sparkId,
    port,
    maxTokens,
    temperature,
    thinking,
    modelId,
    promptType,
    pollOnce,
    schedulePoll,
  ]);

  const handleOpenHistoryRun = useCallback(
    async (sid: string) => {
      if (running || starting) return;
      setRunError(null);
      stopPolling();
      revRef.current = null;
      try {
        const data = await getShowcase(sparkId, sid);
        setViewingHistory(Boolean(data.fromHistory) || data.status !== "running");
        sessionIdRef.current = data.sessionId;
        setSessionId(data.sessionId);
        applySession(data, true);
        if (typeof data.port === "number") setPort(data.port);
        if (data.maxTokens != null) setMaxTokens(data.maxTokens);
        if (data.temperature != null) setTemperature(data.temperature);
        if (typeof data.thinking === "boolean") setThinking(data.thinking);
        if (
          data.promptType === "text" ||
          data.promptType === "structural" ||
          data.promptType === "mixed"
        ) {
          setPromptType(data.promptType);
        }
        if (Array.isArray(data.streams) && data.streams.length) {
          setTerminalCount(data.streams.length);
          setPrompts(data.streams.map((s) => s.prompt || ""));
        }
        const peaks = (data.streams || []).map(
          (s) => Math.max(s.peakTokPerSec || 0, s.decodeTps || 0, s.liveTokPerSec || 0)
        );
        const aggPeak = peaks.reduce((a, b) => a + b, 0);
        setAggregatePeakTps(aggPeak);
        setHistoryOpen(false);
      } catch (err) {
        setRunError(err instanceof Error ? err.message : String(err));
      }
    },
    [running, starting, sparkId, stopPolling, applySession]
  );

  const handleUseHistorySettings = useCallback(
    (row: ShowcaseHistorySummary) => {
      if (running || starting) return;
      if (row.port) setPort(row.port);
      if (row.maxTokens != null) setMaxTokens(row.maxTokens);
      if (row.temperature != null) setTemperature(row.temperature);
      if (typeof row.thinking === "boolean") setThinking(row.thinking);
      if (row.modelId) setModelId(row.modelId);
      if (
        row.promptType === "text" ||
        row.promptType === "structural" ||
        row.promptType === "mixed"
      ) {
        setPromptType(row.promptType);
      }
      // Load full session only for prompts
      void (async () => {
        try {
          const data = await getShowcase(sparkId, row.sessionId);
          if (
            data.promptType === "text" ||
            data.promptType === "structural" ||
            data.promptType === "mixed"
          ) {
            setPromptType(data.promptType);
          }
          if (Array.isArray(data.streams) && data.streams.length) {
            setTerminalCount(data.streams.length);
            setPrompts(data.streams.map((s) => s.prompt || ""));
          }
          setConfigOpen(true);
          setHistoryOpen(false);
          setViewingHistory(false);
        } catch (err) {
          setRunError(err instanceof Error ? err.message : String(err));
        }
      })();
    },
    [running, starting, sparkId]
  );

  const handleClearHistory = useCallback(async () => {
    if (running || starting) return;
    if (!window.confirm("确认清除此节点保存的全部演示历史？")) return;
    try {
      await clearShowcaseHistory(sparkId);
      setHistory([]);
      if (viewingHistory) {
        setViewingHistory(false);
        setStreams([]);
        setSessionId(null);
        setSessionStatus(null);
        sessionIdRef.current = null;
      }
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err));
    }
  }, [running, starting, sparkId, viewingHistory]);

  useEffect(() => {
    let sent = false;
    const cancelBeacon = () => {
      const sid = sessionIdRef.current;
      if (!sid || sessionStatus !== "running" || sent) return;
      sent = true;
      cancelShowcaseOnUnload(sparkId, sid);
    };
    window.addEventListener("pagehide", cancelBeacon);
    window.addEventListener("beforeunload", cancelBeacon);
    return () => {
      window.removeEventListener("pagehide", cancelBeacon);
      window.removeEventListener("beforeunload", cancelBeacon);
    };
  }, [sparkId, sessionStatus]);

  useEffect(
    () => () => {
      stopPolling();
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [stopPolling]
  );

  if (loadError) {
    return (
      <div className="showcase-page">
        <div className="showcase-page__empty">
          <h1>演示</h1>
          <p>{loadError}</p>
        </div>
      </div>
    );
  }

  if (!spark) {
    return (
      <div className="showcase-page">
        <div className="showcase-page__empty">
          <p>正在加载…</p>
        </div>
      </div>
    );
  }

  const monitoringOff = !isLlmMonitoringEnabled(spark) || spark.workerNode;
  const hasCopyable = displayStreams.some((s) => s.content || s.reasoning || s.error);
  const showMetricsStrip =
    aggregateTps > 0 ||
    sessionAvgTps > 0 ||
    totalTokens > 0 ||
    serverTps != null ||
    serverTpsMax != null ||
    running ||
    (sessionStatus != null && sessionStatus !== "pending");

  const gridCols = optimalGridCols(displayStreams.length);
  const gridRows = Math.max(1, Math.ceil(displayStreams.length / gridCols));

  const formatToks = (n: number) =>
    n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString();

  return (
    <div className="showcase-page">
      {!barVisible ? (
        <div className="showcase-config-peek">
          <div className="showcase-config__title">
            <a href="/" className="logo-pill showcase-brand" title="sparkDash 首页">
              <BoltIcon className="showcase-brand__bolt" />
              <span>
                spark<span className="logo-pill-dash" translate="no">Dash</span>
              </span>
            </a>
            <div className="showcase-config__subtitle">
              <span className="showcase-config__name">{spark.name}</span>
              <span className="showcase-config__meta">
                <span className="showcase-config__meta-label">提示词演示</span>
              </span>
            </div>
          </div>
          <div className="showcase-config-peek__actions">
            <button
              type="button"
              className="showcase-btn showcase-btn--ghost showcase-config-peek__show"
              onClick={() => setBarVisible(true)}
              title="显示控制项"
            >
              显示控制项
            </button>
            {(aggregateTps > 0 || totalTokens > 0) && (
              <div className="showcase-config-peek__tps" title="所有终端的总吞吐量">
                <span className="showcase-config-peek__tps-value font-tabular">
                  {aggregateTps > 0 ? `${aggregateTps.toFixed(0)}` : "—"}
                </span>
                <span className="showcase-config-peek__tps-unit">tok/s</span>
                {totalTokens > 0 && (
                  <span className="showcase-config-peek__tps-tokens font-tabular">
                    · {formatToks(totalTokens)} tok
                  </span>
                )}
              </div>
            )}
            {running && (
              <button
                type="button"
                className="showcase-btn showcase-btn--danger"
                onClick={() => {
                  if (window.confirm("确认停止全部演示流？")) void handleStop();
                }}
              >
                停止
              </button>
            )}
          </div>
        </div>
      ) : (
      <div className={`showcase-config${configOpen ? "" : " is-collapsed"}`}>
        <div className="showcase-config__bar">
          <div className="showcase-config__title">
            <a href="/" className="logo-pill showcase-brand" title="sparkDash 首页">
              <BoltIcon className="showcase-brand__bolt" />
              <span>
                spark<span className="logo-pill-dash" translate="no">Dash</span>
              </span>
            </a>
            <div className="showcase-config__subtitle">
              <span className="showcase-config__name">{spark.name}</span>
              <span className="showcase-config__meta">
                <span className="showcase-config__meta-label">提示词演示</span>
              </span>
            </div>
          </div>
          <div className="showcase-config__controls">
            <ThemeSwitch />
            <fieldset className="showcase-config__lockgroup" disabled={controlsLocked}>
              <label className="showcase-field">
                <span className="showcase-field__label">端口</span>
                <select
                  value={port}
                  disabled={controlsLocked}
                  onChange={(e) => setPort(Number(e.target.value))}
                >
                  {llmPorts.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label className="showcase-field">
                <span className="showcase-field__label">终端数量</span>
                <select
                  value={terminalCount}
                  disabled={controlsLocked}
                  onChange={(e) => setTerminalCountSafe(Number(e.target.value))}
                >
                  {TERMINAL_COUNTS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label
                className="showcase-field"
                title={PROMPT_TYPES.find((t) => t.id === promptType)?.hint}
              >
                <span className="showcase-field__label">提示词类型</span>
                <select
                  value={promptType}
                  disabled={controlsLocked}
                  onChange={(e) =>
                    setPromptTypeSafe(e.target.value as ShowcasePromptType)
                  }
                >
                  {PROMPT_TYPES.map((t) => (
                    <option key={t.id} value={t.id} title={t.hint}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="showcase-field">
                <span className="showcase-field__label">最大 token 数</span>
                <input
                  type="number"
                  min={64}
                  max={2048}
                  step={64}
                  value={maxTokens}
                  disabled={controlsLocked}
                  onChange={(e) => setMaxTokens(Number(e.target.value) || DEFAULT_MAX_TOKENS)}
                />
              </label>
              <label className="showcase-field">
                <span className="showcase-field__label">温度</span>
                <input
                  type="number"
                  min={MIN_TEMPERATURE}
                  max={MAX_TEMPERATURE}
                  step={0.1}
                  value={temperature}
                  disabled={controlsLocked}
                  title="采样温度（0–2）"
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (!Number.isFinite(n)) {
                      setTemperature(DEFAULT_TEMPERATURE);
                      return;
                    }
                    setTemperature(
                      Math.min(MAX_TEMPERATURE, Math.max(MIN_TEMPERATURE, n))
                    );
                  }}
                />
              </label>
              <div className="showcase-field">
                <span className="showcase-field__label showcase-field__label--spacer" aria-hidden="true">
                  &nbsp;
                </span>
                <label className="showcase-check" title="启用模型思考／推理 token">
                  <input
                    type="checkbox"
                    checked={thinking}
                    disabled={controlsLocked}
                    onChange={(e) => setThinking(e.target.checked)}
                  />
                  <span>思考</span>
                </label>
              </div>
            </fieldset>
            <div className="showcase-field">
              <span className="showcase-field__label showcase-field__label--spacer" aria-hidden="true">
                &nbsp;
              </span>
              <label className="showcase-check">
                <input
                  type="checkbox"
                  checked={configOpen}
                  onChange={(e) => setConfigOpen(e.target.checked)}
                />
                <span>显示提示词</span>
              </label>
            </div>
            <div className="showcase-field showcase-field--actions">
              <span className="showcase-field__label showcase-field__label--spacer" aria-hidden="true">
                &nbsp;
              </span>
              <div className="showcase-config__actions">
                <button
                  type="button"
                  className="showcase-btn showcase-btn--primary"
                  disabled={!canRun || monitoringOff || controlsLocked}
                  onClick={() => void handleRun()}
                >
                  {starting ? "正在启动…" : "运行"}
                </button>
                {running && (
                  <button
                    type="button"
                    className="showcase-btn showcase-btn--danger"
                    onClick={() => {
                      if (window.confirm("确认停止全部演示流？")) void handleStop();
                    }}
                  >
                    停止
                  </button>
                )}
                <button
                  type="button"
                  className="showcase-btn showcase-btn--ghost"
                  disabled={!hasCopyable}
                  onClick={() => void handleCopyAll()}
                  title="将所有终端复制为纯文本"
                >
                  {copiedId === "all" ? "已复制！" : "全部复制"}
                </button>
                <button
                  type="button"
                  className={`showcase-btn showcase-btn--ghost${historyOpen ? " is-active" : ""}`}
                  onClick={() => setHistoryOpen((o) => !o)}
                  title="历史演示记录"
                >
                  历史记录{history.length > 0 ? ` (${history.length})` : ""}
                </button>
                <button
                  type="button"
                  className="showcase-btn showcase-btn--ghost"
                  onClick={() => setBarVisible(false)}
                  title="隐藏控制项"
                >
                  隐藏
                </button>
              </div>
            </div>
          </div>
        </div>

        {historyOpen && (
          <div className="showcase-history">
            <div className="showcase-history__head">
              <span className="showcase-history__title">历史记录</span>
              <div className="showcase-history__head-actions">
                <button
                  type="button"
                  className="showcase-btn showcase-btn--ghost"
                  disabled={historyLoading}
                  onClick={() => void refreshHistory()}
                >
                  {historyLoading ? "正在加载…" : "刷新"}
                </button>
                <button
                  type="button"
                  className="showcase-btn showcase-btn--ghost"
                  disabled={!history.length || controlsLocked}
                  onClick={() => void handleClearHistory()}
                >
                  清除
                </button>
              </div>
            </div>
            {!history.length && !historyLoading ? (
              <p className="showcase-history__empty">
                暂无已保存的运行记录，演示结束后将自动显示在此处。
              </p>
            ) : (
              <ul className="showcase-history__list">
                {history.map((row) => {
                  const when = row.startedAt
                    ? new Date(row.startedAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "—";
                  const active = viewingHistory && sessionId === row.sessionId;
                  return (
                    <li
                      key={row.sessionId}
                      className={`showcase-history__item${active ? " is-active" : ""}`}
                    >
                      <button
                        type="button"
                        className="showcase-history__main"
                        disabled={controlsLocked}
                        onClick={() => void handleOpenHistoryRun(row.sessionId)}
                        title="查看此次运行"
                      >
                        <span className="showcase-history__when">{when}</span>
                        <span className="showcase-history__meta">
                          <span className={`showcase-history__status showcase-history__status--${row.status}`}>
                            {({running:'运行中',completed:'已完成',failed:'失败',cancelled:'已取消'} as Record<string,string>)[row.status]||row.status}
                          </span>
                          <span>· :{row.port}</span>
                          <span>· {row.streamCount} 终端</span>
                          {row.promptType ? (
                            <span>· {row.promptType}</span>
                          ) : null}
                          {row.meanDecodeTps > 0 && (
                            <span>· 平均 {row.meanDecodeTps.toFixed(0)} tok/s</span>
                          )}
                          {row.totalTokens > 0 && (
                            <span>· {formatToks(row.totalTokens)} tok</span>
                          )}
                        </span>
                        {row.modelId ? (
                          <span className="showcase-history__model" title={row.modelId}>
                            {row.modelId}
                          </span>
                        ) : null}
                      </button>
                      <button
                        type="button"
                        className="showcase-btn showcase-btn--ghost showcase-history__reuse"
                        disabled={controlsLocked}
                        onClick={() => handleUseHistorySettings(row)}
                        title="将提示词和设置载入表单（不会重新运行）"
                      >
                        复用
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {configOpen && (
          <div className="showcase-config__prompts">
            {prompts.map((p, i) => (
              <label key={i} className="showcase-prompt">
                <span className="showcase-prompt__label">提示词 {i + 1}</span>
                <textarea
                  value={p}
                  disabled={controlsLocked}
                  rows={2}
                  onChange={(e) => {
                    const v = e.target.value;
                    setPrompts((prev) => prev.map((x, j) => (j === i ? v : x)));
                  }}
                />
              </label>
            ))}
          </div>
        )}

        {(runError || monitoringOff) && (
          <p className="showcase-config__error">
            {monitoringOff
              ? "模型监控未开启，或此节点为工作节点，无法使用演示功能。"
              : runError}
          </p>
        )}
      </div>
      )}

      {!running && availability.message && !monitoringOff && <div className="showcase-notice" role="status"><span>{availability.message}</span><div><button className="showcase-btn showcase-btn--ghost" disabled={availability.checking} onClick={()=>void availability.refresh()}>{availability.checking?'检查中…':'刷新状态'}</button><a href={`/spark/${encodeURIComponent(sparkId)}`}>查看节点任务</a></div></div>}
      {runError && !barVisible && <p className="showcase-config__error" role="alert">{runError}</p>}
      {modelId ? (
        <header className="showcase-model-header" title={modelId}>
          <span className="showcase-model-header__label">模型</span>
          <h1 className="showcase-model-header__name">{modelId}</h1>
        </header>
      ) : null}

      {showMetricsStrip && (
        <div className="showcase-metrics" aria-live="polite">
          <div className="showcase-metrics__hero" title="所有终端当前解码吞吐量之和（tok/s）">
            <span className="showcase-metrics__label">合计</span>
            <span className="showcase-metrics__hero-value font-tabular">
              {aggregateTps > 0 ? aggregateTps.toFixed(0) : "—"}
              <span className="showcase-metrics__hero-unit">tok/s</span>
            </span>
            {aggregatePeakTps > 0 && (
                <span className="showcase-metrics__sub">
                  峰值 {aggregatePeakTps.toFixed(0)}
                </span>
              )}
          </div>
          {runFinished && sessionAvgTps > 0 && (
            <>
              <span className="showcase-metrics__sep" aria-hidden>
                ·
              </span>
              <div
                className="showcase-metrics__item"
                title="本次会话每个终端的平均解码吞吐量（tok/s）"
              >
                <span className="showcase-metrics__label">平均</span>
                <span className="showcase-metrics__value font-tabular">
                  {sessionAvgTps.toFixed(0)}
                  <span className="showcase-metrics__unit"> tok/s</span>
                </span>
                <span className="showcase-metrics__sub">每条流</span>
              </div>
            </>
          )}
          <span className="showcase-metrics__sep" aria-hidden>
            ·
          </span>
          <div className="showcase-metrics__item">
            <span className="showcase-metrics__label">生成 Token 数</span>
            <span className="showcase-metrics__value font-tabular">
              {totalTokens > 0 ? formatToks(totalTokens) : "—"}
            </span>
          </div>
          <span className="showcase-metrics__sep" aria-hidden>
            ·
          </span>
          <div className="showcase-metrics__item">
            <span className="showcase-metrics__label">服务端</span>
            <span className="showcase-metrics__value font-tabular">
              {serverTps != null ? `${serverTps.toFixed(0)}` : "—"}
              {serverTps != null && (
                <span className="showcase-metrics__unit"> tok/s</span>
              )}
            </span>
            {serverTpsMax != null && serverTpsMax > 0 && (
                <span className="showcase-metrics__sub">
                  峰值 {serverTpsMax.toFixed(0)}
                </span>
              )}
          </div>
          <span className="showcase-metrics__sep" aria-hidden>
            ·
          </span>
          <div className="showcase-metrics__item">
            <span className="showcase-metrics__label">并行流</span>
            <span className="showcase-metrics__value font-tabular">
              {
                displayStreams.filter(
                  (s) => s.status === "streaming" || s.status === "completed"
                ).length
              }
              /{displayStreams.length}
            </span>
          </div>
        </div>
      )}

      <div
        className="showcase-grid"
        style={{
          ["--showcase-cols" as string]: String(gridCols),
          ["--showcase-rows" as string]: String(gridRows),
        }}
      >
        {displayStreams.map((s, index) => (
          <TerminalCard
            key={s.streamId}
            label={`终端 ${index + 1}`}
            status={s.status}
            liveTokPerSec={s.liveTokPerSec}
            peakTokPerSec={s.peakTokPerSec}
            content={s.content}
            reasoning={s.reasoning}
            error={s.error}
            onCopy={
              s.content || s.reasoning || s.error
                ? () => void handleCopyOne(s)
                : undefined
            }
            copied={copiedId === s.streamId}
          />
        ))}
      </div>

      {sessionId && sessionStatus && sessionStatus !== "running" && (
        <p className="showcase-page__footer-note">
          {viewingHistory ? "历史记录 ·" : "会话"}
          {sessionStatus}
          {sessionId ? ` · ${sessionId.slice(0, 8)}…` : ""}
          {viewingHistory ? "· 只读" : ""}
        </p>
      )}
    </div>
  );
}
