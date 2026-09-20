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
import { BrandLink } from '../ui/BrandLink';
import { TerminalCard } from "./TerminalCard";
import { ThemeSwitch } from '../ThemeSwitch';
import { GridIcon } from '../ui/icons';
import { checkShowcaseAvailability, useShowcaseAvailability } from '../../hooks/useShowcaseAvailability';
import {
  PROMPT_TYPES,
  pickShowcasePrompts,
  type ShowcasePromptType,
} from "./showcasePrompts";

import './showcase.css';

const sessionLabels: Record<string, string> = { running: '运行中', pending: '等待中', streaming: '生成中', completed: '已完成', failed: '失败', error: '失败', cancelled: '已停止', unavailable: '会话不可用' };
const sessionLabel = (status: string | null) => status ? sessionLabels[status] || '未知状态' : '未开始';
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
    const n = Number(q);
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
  const parts: string[] = [`## ${s.label || s.streamId}`, `状态：${sessionLabel(s.status)}`];
  if (s.liveTokPerSec > 0 || s.decodeTps > 0 || s.peakTokPerSec > 0) {
    const live = s.status === 'streaming' ? s.liveTokPerSec : s.decodeTps;
    parts.push(
      `${s.status === 'streaming' ? '当前速率' : '平均速率'}：${live > 0 || s.status === 'streaming' ? live.toFixed(1) : "—"} tok/s` +
        (s.peakTokPerSec > 0 ? ` · 峰值 ${s.peakTokPerSec.toFixed(1)} tok/s` : "") +
        (s.ttftMs != null ? ` · 首字延迟 ${s.ttftMs.toFixed(0)} ms` : "")
    );
  }
  parts.push("");
  if (s.reasoning) {
    parts.push("### 思考过程", s.reasoning, "");
  }
  if (s.content) {
    parts.push("### 回答", s.content);
  }
  if (s.error) {
    parts.push("", `[错误] ${s.error}`);
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
    `${meta.name} | 并发生成测试`,
    `端口 ${meta.port}` +
      (meta.modelId ? `  ·  ${meta.modelId}` : "") +
      (meta.sessionAvgTps != null && meta.sessionAvgTps > 0
        ? `  · 单请求平均 ${meta.sessionAvgTps.toFixed(1)} tok/s`
        : "") +
      (meta.serverTps != null ? `  · 服务端 ${meta.serverTps.toFixed(1)} tok/s` : ""),
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
  const [port, setPort] = useState(() => readPortQuery(8888));
  const [modelId, setModelId] = useState<string | null>(() => readModelQuery());
  const [maxTokens, setMaxTokens] = useState(DEFAULT_MAX_TOKENS);
  const [temperature, setTemperature] = useState(DEFAULT_TEMPERATURE);
  const [thinking, setThinking] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [stopping, setStopping] = useState(false);
  const stoppingRef = useRef(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<string | null>(null);
  const [streams, setStreams] = useState<LocalStream[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [serverTps, setServerTps] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<ShowcaseHistorySummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [viewingHistory, setViewingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const historyBusyRef = useRef(false);
  const historyRevision = useRef(0);
  const [resultLayout, setResultLayout] = useState<'grid' | 'list'>('grid');

  const revRef = useRef<number | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const startingRef = useRef(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollEpoch = useRef(0);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = sessionStatus === "running";
  const controlsLocked = !spark || Boolean(loadError) || running || starting || historyBusy || stopping;
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

  // Completed streams do not contribute to the current, live throughput.
  const aggregateTps = useMemo(() => displayStreams.reduce(
    (sum, stream) => sum + (stream.status === 'streaming' ? Math.max(0, stream.liveTokPerSec) : 0), 0
  ), [displayStreams]);

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
    if (!sparkId || !spark || viewingHistory || historyBusy || running) return;
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
  }, [sparkId, spark, port, viewingHistory, historyBusy, running]);

  const resetResults = useCallback(() => {
    setStreams([]);
    setSessionId(null);
    sessionIdRef.current = null;
    revRef.current = null;
    setSessionStatus(null);
    setViewingHistory(false);
    setServerTps(null);
    setRunError(null);
  }, []);

  const setTerminalCountSafe = useCallback(
    (n: number) => {
      if (controlsLocked) return;
      resetResults();
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
    [running, starting, promptType, controlsLocked, resetResults]
  );

  const setPromptTypeSafe = useCallback(
    (t: ShowcasePromptType) => {
      if (controlsLocked) return;
      resetResults();
      setPromptType(t);
      if (!running && !starting) {
        setPrompts(pickShowcasePrompts(t, terminalCount));
        setStreams([]);
        setViewingHistory(false);
      }
    },
    [running, starting, terminalCount, controlsLocked, resetResults]
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
    const incomingModel = data.modelId || data.streams.find((s) => s.model)?.model;
    if (incomingModel || full) setModelId(incomingModel || null);
    if (full || data.serverGenerationTps != null) setServerTps(data.serverGenerationTps ?? null);
    setStreams((prev) => {
      const byId = new Map(prev.map((s) => [s.streamId, s]));
      return data.streams.map((s) => {
        // Full snapshots replace a session; stream IDs are reused across runs.
        const old = full ? undefined : byId.get(s.streamId);
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
    if (!sparkId || historyBusyRef.current) return;
    const revision = ++historyRevision.current;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const data = await listShowcase(sparkId);
      if (revision === historyRevision.current) setHistory(data.history || []);
    } catch {
      if (revision === historyRevision.current) setHistoryError("历史记录暂时无法加载，请重试。");
    } finally {
      if (revision === historyRevision.current) setHistoryLoading(false);
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
    if (!sid || stoppingRef.current) return;
    stoppingRef.current = true;
    setStopping(true);
    stopPolling();
    try {
      const data = await cancelShowcase(sparkId, sid);
      applySession(data, false);
      if (data.status === 'running') schedulePoll(sid);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err));
      if (sessionIdRef.current === sid) schedulePoll(sid, 1000);
    } finally {
      stoppingRef.current = false;
      setStopping(false);
    }
  }, [sparkId, applySession, stopPolling, schedulePoll]);

  const handleRun = useCallback(async () => {
    if (!canRun || startingRef.current || historyBusyRef.current) return;
    startingRef.current = true;
    setRunError(null);
    setStarting(true);
    try {
      const blocking = await checkShowcaseAvailability(sparkId);
      if (blocking) throw new Error(blocking);
      const trimmed = prompts.map((p) => p.trim());
      if (trimmed.some(p => !p)) throw new Error("每个请求都需要提示词，请补全后再开始。");
      if (!Number.isInteger(maxTokens) || maxTokens < 64 || maxTokens > 2048) throw new Error("输出上限须为 64–2048 的整数。");
      if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) throw new Error("采样温度须在 0–2 之间。");
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("请选择有效的服务端口。");
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
      sessionIdRef.current = started.sessionId;
      setSessionId(started.sessionId);
      setSessionStatus("running");
      setConfigOpen(false);
      setSettingsOpen(open => window.innerWidth > 900 ? open : false);
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
      if (controlsLocked || historyBusyRef.current) return;
      historyBusyRef.current = true;
      setHistoryBusy(true);
      setRunError(null);
      stopPolling();
      revRef.current = null;
      try {
        const data = await getShowcase(sparkId, sid);
        if (data.status === "running") throw new Error("此记录仍在运行，请返回原演示窗口查看。");
        setViewingHistory(true);
        setSettingsOpen(open => window.innerWidth > 900 ? open : false);
        sessionIdRef.current = null;
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
        setHistoryOpen(false);
      } catch (err) {
        setRunError(err instanceof Error ? err.message : String(err));
      } finally {
        historyBusyRef.current = false;
        setHistoryBusy(false);
      }
    },
    [controlsLocked, sparkId, stopPolling, applySession]
  );

  const handleUseHistorySettings = useCallback(async (row: ShowcaseHistorySummary) => {
    if (controlsLocked || historyBusyRef.current) return;
    historyBusyRef.current = true;
    setHistoryBusy(true);
    setRunError(null);
    try {
      const data = await getShowcase(sparkId, row.sessionId);
      if (!data.streams?.length) throw new Error('此记录没有可复用的提示词。');
      resetResults();
      setPort(data.port ?? row.port);
      setMaxTokens(data.maxTokens ?? row.maxTokens ?? DEFAULT_MAX_TOKENS);
      setTemperature(data.temperature ?? row.temperature ?? DEFAULT_TEMPERATURE);
      setThinking(data.thinking ?? row.thinking ?? false);
      setModelId(data.modelId || row.modelId || null);
      const type = data.promptType ?? row.promptType;
      if (type === 'text' || type === 'structural' || type === 'mixed') setPromptType(type);
      setTerminalCount(data.streams.length);
      setPrompts(data.streams.map(stream => stream.prompt || ''));
      setConfigOpen(true);
      setSettingsOpen(true);
      setHistoryOpen(false);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err));
    } finally {
      historyBusyRef.current = false;
      setHistoryBusy(false);
    }
  }, [controlsLocked, sparkId, resetResults]);

  const handleClearHistory = useCallback(async () => {
    if (controlsLocked || historyBusyRef.current) return;
    if (!window.confirm("确认清除此节点保存的全部测试历史？此操作无法撤销。")) return;
    ++historyRevision.current;
    setHistoryLoading(false);
    setHistoryError(null);
    historyBusyRef.current = true;
    setHistoryBusy(true);
    try {
      await clearShowcaseHistory(sparkId);
      setHistory([]);
      if (viewingHistory) resetResults();
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err));
    }
    finally { historyBusyRef.current = false; setHistoryBusy(false); }
  }, [controlsLocked, sparkId, viewingHistory, resetResults]);

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
      ++historyRevision.current;
      stopPolling();
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [stopPolling]
  );


  const monitoringOff = Boolean(spark && (!isLlmMonitoringEnabled(spark) || spark.workerNode));
  const initializing = !spark || availability.message === '正在检查任务占用…';
  const notice = loadError || (monitoringOff ? '此节点未开启模型监控或属于工作节点，请从主节点使用此功能。' : runError || (!initializing && availability.message));
  const hasCopyable = displayStreams.some(s => s.content || s.reasoning || s.error);
  const hasResults = sessionStatus !== null;
  const finishedCount = displayStreams.filter(s => ['completed', 'cancelled', 'error', 'failed'].includes(s.status)).length;
  const ttfts = displayStreams.flatMap(s => s.ttftMs != null && Number.isFinite(s.ttftMs) ? [s.ttftMs] : []);
  const avgTtft = ttfts.length ? ttfts.reduce((a, b) => a + b, 0) / ttfts.length : null;
  const changed = (update: () => void) => { if (!controlsLocked) { resetResults(); update(); } };
  const servicePorts = [...new Set([...llmPorts, port])];

  return (
    <main className="showcase-workbench">
      <header className="sw-topbar">
        <BrandLink />
        <div className="sw-topbar__actions"><a href="/" className="sw-back icon-circle" title="概览" aria-label="概览"><GridIcon className="h-3.5 w-3.5" /></a><ThemeSwitch /></div>
      </header>
      <div className="sw-shell">
        <section className="sw-heading" aria-labelledby="sw-title">
          <div><h1 id="sw-title">并发生成测试<span className="sw-heading-description"> - 对比生成表现</span></h1></div>
          <div className="sw-model"><strong title={modelId || undefined}>{modelId || '模型名称待确认'}</strong><span> · {spark?.name || sparkId} · 端口 {port}</span></div>
        </section>
        {notice && <div className="sw-notice" role="status">
          <p>{notice}</p>
          {loadError ? <button className="showcase-btn" onClick={() => window.location.reload()}>重新加载</button> : !runError && !monitoringOff && <button className="showcase-btn" onClick={() => void availability.refresh()}>重新检查</button>}
        </div>}
        <div className={'sw-layout' + (!hasResults && !historyOpen && !configOpen && settingsOpen ? ' sw-layout--balanced' : '')} aria-busy={!spark && !loadError}>
          <aside className="sw-panel sw-configuration" aria-labelledby="sw-config-title">
            <div className="sw-panel-heading"><h2 id="sw-config-title">测试配置</h2><button className="sw-config-toggle" aria-expanded={settingsOpen} aria-controls="sw-settings" onClick={() => setSettingsOpen(o => !o)}>{settingsOpen ? '收起配置' : '调整配置'}</button></div>
            <div id="sw-settings" hidden={!settingsOpen}>
            <fieldset className="sw-fields" disabled={controlsLocked}>
              <legend className="sr-only">生成参数</legend>
              <label className="sw-field"><span>服务端口</span><select value={port} onChange={e => changed(() => setPort(Number(e.target.value)))}>{servicePorts.map(p => <option key={p} value={p}>{p}</option>)}</select></label>
              <label className="sw-field"><span>并发请求数</span><select value={terminalCount} onChange={e => setTerminalCountSafe(Number(e.target.value))}>{TERMINAL_COUNTS.map(n => <option key={n} value={n}>{n} 路</option>)}</select></label>
              <label className="sw-field sw-field--wide"><span>提示词类型</span><select value={promptType} onChange={e => setPromptTypeSafe(e.target.value as ShowcasePromptType)}>{PROMPT_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select><small>{PROMPT_TYPES.find(t => t.id === promptType)?.hint}</small></label>
              <label className="sw-field"><span>输出上限 <small>tok / 请求</small></span><input type="number" min={64} max={2048} step={1} value={Number.isNaN(maxTokens) ? '' : maxTokens} onChange={e => changed(() => setMaxTokens(e.target.value === '' ? NaN : Number(e.target.value)))} /></label>
              <label className="sw-field"><span>采样温度</span><input type="number" min={MIN_TEMPERATURE} max={MAX_TEMPERATURE} step={0.1} value={Number.isNaN(temperature) ? '' : temperature} onChange={e => changed(() => setTemperature(e.target.value === '' ? NaN : Number(e.target.value)))} /></label>
              <label className="sw-thinking"><div><span>模型思考</span><small>需模型支持，思考内容单独展示</small></div><input type="checkbox" checked={thinking} onChange={e => changed(() => setThinking(e.target.checked))} /></label>
            </fieldset>
            <div className="sw-prompts">
              <button type="button" className="sw-disclosure" aria-expanded={configOpen} aria-controls="sw-prompt-fields" onClick={() => setConfigOpen(o => !o)}><span>编辑提示词 <small>{prompts.length} 条</small></span><span>{configOpen ? '收起' : '展开'}</span></button>
              {configOpen && <div id="sw-prompt-fields" className="sw-prompt-fields">{prompts.map((p, i) => <label className="sw-field" key={i}><span>请求 {String(i + 1).padStart(2, '0')}</span><textarea rows={4} value={p} disabled={controlsLocked} onChange={e => changed(() => setPrompts(prev => prev.map((v, j) => j === i ? e.target.value : v)))} /></label>)}</div>}
            </div>
            </div>
            <div className="sw-run">
              <button type="button" className="showcase-btn showcase-btn--primary" disabled={!canRun || monitoringOff} onClick={() => void handleRun()}>{starting ? '正在启动…' : running ? '测试运行中' : '开始测试'}</button>
              {running && <button type="button" className="showcase-btn showcase-btn--danger" disabled={stopping} onClick={() => { if (window.confirm('确认停止本次测试的全部请求？')) void handleStop(); }}>{stopping ? '正在停止…' : '停止测试'}</button>}
              <p>{running ? '保持此页打开，离开或刷新会停止本次测试。' : '手动启动后会向模型发送请求，并占用推理资源。'}</p>
            </div>
          </aside>

          <section className="sw-panel sw-results" aria-labelledby="sw-results-title">
            <div className="sw-results-heading"><div><h2 id="sw-results-title">测试结果</h2><span className="sw-status" data-status={sessionStatus || 'idle'}>{viewingHistory ? '历史记录 · ' : ''}{historyBusy ? '正在读取…' : sessionLabel(sessionStatus)}</span></div>
              <div className="sw-actions"><button type="button" className="showcase-btn" disabled={!hasCopyable} onClick={() => void handleCopyAll()}>{copiedId === 'all' ? '已复制' : '复制结果'}</button><button type="button" className="showcase-btn" aria-expanded={historyOpen} aria-controls="sw-history" onClick={() => setHistoryOpen(o => !o)}>历史记录{history.length ? '（' + history.length + '）' : ''}</button></div>
            </div>

            <div className="sw-results-body">
            {historyOpen && <section id="sw-history" className="sw-panel sw-history" aria-label="测试历史">
              <div className="sw-panel-heading"><h3>测试历史</h3><div className="sw-actions"><button className="showcase-btn" disabled={historyLoading || historyBusy} onClick={() => void refreshHistory()}>{historyLoading ? '加载中…' : '刷新'}</button><button className="showcase-btn" disabled={!history.length || controlsLocked} onClick={() => void handleClearHistory()}>清空历史</button></div></div>
              {historyError ? <p role="alert" className="sw-history-message">{historyError}</p> : !history.length && <p className="sw-history-message">{historyLoading ? '正在读取历史记录…' : '暂无历史记录，测试结束后会自动保存。'}</p>}
              <ul className="sw-history-list">{history.map(row => <li key={row.sessionId} className={viewingHistory && sessionId === row.sessionId ? 'is-selected' : ''}>
                <div><strong>{row.modelId || '模型名称未记录'}</strong><span>{row.startedAt ? new Date(row.startedAt).toLocaleString('zh-CN', {month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false}) : '时间未记录'} · {row.streamCount} 路 · {sessionLabel(row.status)}</span><span>端口 {row.port} · 单请求平均 {row.meanDecodeTps > 0 ? row.meanDecodeTps.toFixed(1) + ' tok/s' : '—'}</span></div>
                <div className="sw-actions"><button className="showcase-btn" disabled={controlsLocked} onClick={() => void handleOpenHistoryRun(row.sessionId)}>查看结果</button><button className="showcase-btn" disabled={controlsLocked} onClick={() => void handleUseHistorySettings(row)} title="仅填入配置，不会自动运行">复用配置</button></div>
              </li>)}</ul>
            </section>}

            <div className="sw-metrics" aria-label="本次测试指标">
              <div><span>{runFinished ? '单请求平均速率' : '当前合计速率'}</span><strong>{hasResults && (!runFinished || sessionAvgTps > 0) ? (runFinished ? sessionAvgTps : aggregateTps).toFixed(1) : '—'}<small>tok/s</small></strong></div>
              <div><span>平均首字延迟</span><strong>{avgTtft == null ? '—' : (avgTtft / 1000).toFixed(2)}<small>s</small></strong></div>
              <div><span>已生成令牌</span><strong>{hasResults ? totalTokens.toLocaleString() : '—'}<small>tok</small></strong></div>
              <div><span>已结束请求</span><strong>{hasResults ? finishedCount : '—'}<small>/ {terminalCount}</small></strong></div>
            </div>
            {!hasResults ? <div className="sw-panel sw-empty"><span className="sw-eyebrow">{loadError ? '节点加载失败' : !spark ? '正在加载节点…' : initializing ? '正在检查任务占用…' : availability.message || monitoringOff ? '等待可用服务' : '准备就绪'}</span><h3>从一次并发生成开始</h3><p>已准备 {terminalCount} 条{PROMPT_TYPES.find(t => t.id === promptType)?.label}提示词，可直接使用或展开编辑。<br />开始后将在这里展示每路回答、首字延迟与生成速率。</p><div className="sw-empty-steps"><span>配置请求</span><span>开始测试</span><span>对比结果</span></div></div> : <>
              <div className="sw-viewbar"><span>{viewingHistory ? '已保存的结果' : running ? '生成内容实时更新' : '本次测试已结束'} · {displayStreams.length} 路请求</span><div className="sw-segment" aria-label="结果布局"><button aria-pressed={resultLayout === 'grid'} onClick={() => setResultLayout('grid')}>并排</button><button aria-pressed={resultLayout === 'list'} onClick={() => setResultLayout('list')}>列表</button></div></div>
              <div className={'sw-streams sw-streams--' + resultLayout}>{displayStreams.map((s, i) => <TerminalCard key={(sessionId || 'draft') + ':' + s.streamId} label={'请求 ' + String(i + 1).padStart(2, '0')} prompt={s.prompt} status={s.status} content={s.content} reasoning={s.reasoning} error={s.error} liveTokPerSec={s.liveTokPerSec} peakTokPerSec={s.peakTokPerSec} decodeTps={s.decodeTps} tokenCount={s.tokenCount} ttftMs={s.ttftMs} onCopy={() => void handleCopyOne(s)} copied={copiedId === s.streamId} />)}</div>
            </>}
            </div>
            <p className="sw-footnote">仅统计本页测试请求，不等同于整个模型服务的吞吐。历史记录仅供回看，复用配置不会自动启动。</p>
          </section>
        </div>
      </div>
    </main>
  );
}
