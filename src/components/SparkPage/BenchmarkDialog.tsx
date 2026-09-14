import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  cancelDecodeBench,
  clearDecodeBenchHistory,
  getDecodeBench,
  listDecodeBench,
  startDecodeBench,
} from "../../api/client";
import type { DecodeBenchJob, DecodeBenchPromptType, LlmBenchTarget } from "../../api/types";
import { useModalPresence } from "../../hooks/useModalPresence";
import { formatLlmBaseUrl } from "../../shared/llmTarget.js";
import {
  DECODE_BENCH_DEFAULT_TYPE,
  DECODE_BENCH_TYPE_META,
  decodeBenchTypeLabel,
  normalizeDecodeBenchType,
} from "../../shared/llmPrompts.js";

const CONCURRENCY_OPTIONS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 24, 32] as const;
const DEFAULT_SELECTED = [1, 2];
const DEFAULT_MAX_TOKENS = 400;
const DEFAULT_PROMPT_TYPE: DecodeBenchPromptType = DECODE_BENCH_DEFAULT_TYPE;

interface BenchmarkDialogProps {
  open: boolean;
  onClose: () => void;
  sparkId: string;
  llmPort: number;
  modelId: string | null;
  remoteTarget?: LlmBenchTarget | null;
}

function useEscape(onClose: () => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose, enabled]);
}

/** Lock body scroll while the modal is open (important on iOS). */
function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [locked]);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  return `${m}m ${rem.toFixed(0)}s`;
}

function statusLabel(status: DecodeBenchJob["status"]): string {
  switch (status) {
    case "running":
      return "运行中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    default:
      return status;
  }
}

function formatTtft(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

/**
 * Build a plain-text benchmark summary for the clipboard.
 * Format: "<model> | decode tok/s results:" header, then one line per
 * concurrency level with decode tok/s and key metrics.
 */
function buildShareText(job: DecodeBenchJob, modelId: string | null): string {
  const name = modelId || "unknown model";
  const typeLabel = decodeBenchTypeLabel(job.config?.promptType);
  const head = `${name} | decode tok/s results (${typeLabel}):`;

  const lines = job.results
    .slice()
    .sort((a, b) => a.concurrency - b.concurrency)
    .map((r) => {
      if (r.totalDecodeTokens > 0 || r.totalCompletionTokens > 0) {
        const agg = r.aggregateDecodeTps > 0 ? r.aggregateDecodeTps : r.meanDecodeTps;
        return `×${r.concurrency}  ${agg.toFixed(1)} agg  ${r.meanDecodeTps.toFixed(1)}/str  · TTFT ${formatTtft(r.meanTtftMs)}`;
      }
      return `×${r.concurrency}  failed${r.error ? ` — ${r.error}` : ""}`;
    });

  return [head, "", ...lines].join("\n");
}

function ResultRow({ r }: { r: DecodeBenchJob["results"][number] }) {
  return (
    <article className="bench-result-row" title={r.error || undefined}>
      <div className="bench-result-row__load">
        <span className="bench-result-row__badge">×{r.concurrency}</span>
        <div className="bench-result-row__facts">
          <span>
            TTFT <strong>{formatTtft(r.meanTtftMs)}</strong>
          </span>
          <span className="bench-result-row__sep" aria-hidden>
            ·
          </span>
          <span className={r.streamsFailed ? "text-warning" : undefined}>
            <strong>
              {r.streamsOk}/{r.streamsOk + r.streamsFailed}
            </strong>{" "}
            条流
          </span>
        </div>
      </div>

      <div className="bench-result-row__speeds">
        <div className="bench-result-row__metric">
          <span className="bench-result-row__label">合计</span>
          <span className="bench-result-row__value bench-result-row__value--accent">
            {(r.aggregateDecodeTps > 0 ? r.aggregateDecodeTps : r.meanDecodeTps).toFixed(1)}
            <span className="bench-result-row__unit">tok/s</span>
          </span>
        </div>
        <div className="bench-result-row__metric">
          <span className="bench-result-row__label">流</span>
          <span className="bench-result-row__value">
            {r.meanDecodeTps.toFixed(1)}
            <span className="bench-result-row__unit">tok/s</span>
          </span>
        </div>
      </div>
    </article>
  );
}

export function BenchmarkDialog({
  open,
  onClose,
  sparkId,
  llmPort,
  modelId,
  remoteTarget = null,
}: BenchmarkDialogProps) {
  const [selected, setSelected] = useState<number[]>([...DEFAULT_SELECTED]);
  const [maxTokensDraft, setMaxTokensDraft] = useState(String(DEFAULT_MAX_TOKENS));
  const [promptType, setPromptType] = useState<DecodeBenchPromptType>(DEFAULT_PROMPT_TYPE);
  const [job, setJob] = useState<DecodeBenchJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [loadingLast, setLoadingLast] = useState(false);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const benchPort = remoteTarget?.port ?? llmPort;

  const stopPoll = useCallback(() => {
    if (pollRef.current != null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const isRunning = job?.status === "running";

  const { mounted, visible } = useModalPresence(open);

  useEscape(onClose, open && !starting);
  useBodyScrollLock(mounted);

  const applyJobConfig = useCallback((j: DecodeBenchJob) => {
    if (Array.isArray(j.config?.concurrencies) && j.config.concurrencies.length > 0) {
      setSelected([...j.config.concurrencies].sort((a, b) => a - b));
    }
    if (j.config?.maxTokens != null) {
      setMaxTokensDraft(String(j.config.maxTokens));
    }
    // Last-run type is shown on results; the picker always defaults to Structured
    // for the next Run. Only a still-running job pins the picker.
    if (j.status === "running" && j.config?.promptType) {
      setPromptType(normalizeDecodeBenchType(j.config.promptType));
    } else {
      setPromptType(DEFAULT_PROMPT_TYPE);
    }
  }, []);

  const startPolling = useCallback(
    (benchId: string) => {
      stopPoll();
      pollRef.current = setInterval(() => {
        void getDecodeBench(sparkId, benchId)
          .then((j) => {
            setJob(j);
            setError(null);
            if (j.status !== "running") stopPoll();
          })
          .catch((err: Error) => {
            // Server --watch / restart can drop the in-memory job for a moment.
            // Recover via list, or show a clear interrupt message instead of a bare 404.
            void listDecodeBench(sparkId, benchPort)
              .then((data) => {
                if (data.active) {
                  setJob(data.active);
                  setError(null);
                  if (data.active.benchId !== benchId) {
                    startPolling(data.active.benchId);
                  } else if (data.active.status !== "running") {
                    stopPoll();
                  }
                  return;
                }
                const finished =
                  data.history?.find((j) => j.benchId === benchId) ||
                  (data.last?.benchId === benchId ? data.last : null);
                if (finished) {
                  setJob(finished);
                  setError(null);
                  stopPoll();
                  return;
                }
                setError(
                  ["Benchmark not found", "找不到基准测试记录"].includes(err.message)
                    ? "基准测试中断，运行期间服务已重启"
                    : err.message
                );
                stopPoll();
              })
              .catch(() => {
                setError(
                  ["Benchmark not found", "找不到基准测试记录"].includes(err.message)
                    ? "基准测试中断，运行期间服务已重启"
                    : err.message
                );
                stopPoll();
              });
          });
      }, 800);
    },
    [sparkId, benchPort, stopPoll]
  );

  useEffect(() => {
    if (!open) {
      stopPoll();
      setPromptType(DEFAULT_PROMPT_TYPE);
      return;
    }
    setError(null);
    let cancelled = false;
    setLoadingLast(true);
    listDecodeBench(sparkId, benchPort)
      .then((data) => {
        if (cancelled) return;
        if (data.active) {
          setJob(data.active);
          applyJobConfig(data.active);
          if (data.active.status === "running") {
            startPolling(data.active.benchId);
          }
          return;
        }
        if (data.last) {
          setJob(data.last);
          applyJobConfig(data.last);
          return;
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingLast(false);
      });
    return () => {
      cancelled = true;
      stopPoll();
    };
  }, [open, sparkId, benchPort, stopPoll, startPolling, applyJobConfig]);

  useEffect(() => () => stopPoll(), [stopPoll]);

  useEffect(
    () => () => {
      if (copyResetRef.current != null) clearTimeout(copyResetRef.current);
    },
    []
  );

  const toggleConcurrency = (n: number) => {
    if (isRunning || starting) return;
    setSelected((prev) => {
      if (prev.includes(n)) {
        if (prev.length === 1) return prev;
        return prev.filter((x) => x !== n).sort((a, b) => a - b);
      }
      return [...prev, n].sort((a, b) => a - b);
    });
  };

  const handleStart = async () => {
    if (selected.length === 0) {
      setError("请至少选择一个并发档位");
      return;
    }
    const maxTokens = parseInt(maxTokensDraft.trim(), 10);
    if (!Number.isInteger(maxTokens) || maxTokens < 64 || maxTokens > 2048) {
      setError("最大 Token 数必须是 64–2048 之间的整数");
      return;
    }
    setStarting(true);
    setError(null);
    setJob(null);
    try {
      const started = await startDecodeBench(sparkId, {
        port: benchPort,
        concurrencies: selected,
        maxTokens,
        modelId: modelId || undefined,
        promptType,
        ...(remoteTarget
          ? { host: remoteTarget.host, tls: remoteTarget.tls }
          : {}),
      });
      setJob(started);
      startPolling(started.benchId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  const handleCancel = async () => {
    if (!job || job.status !== "running") return;
    try {
      const j = await cancelDecodeBench(sparkId, job.benchId);
      setJob(j);
      startPolling(job.benchId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleNewRun = () => {
    stopPoll();
    setJob(null);
    setError(null);
  };

  const handleCopyResults = async () => {
    if (!job || job.results.length === 0) return;
    const text = buildShareText(job, modelId);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      if (copyResetRef.current != null) clearTimeout(copyResetRef.current);
      copyResetRef.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("无法将结果复制到剪贴板");
    }
  };

  const handleClear = async () => {
    if (!job || job.status === "running") return;
    setError(null);
    try {
      await clearDecodeBenchHistory(sparkId, benchPort);
      stopPoll();
      setJob(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!mounted) return null;

  const progressPct =
    job && job.progress.totalLevels > 0
      ? Math.round(
          ((job.progress.completedLevels + (job.status === "running" ? 0.35 : 0)) /
            job.progress.totalLevels) *
            100
        )
      : 0;

  const showConfig = (!job || job.status === "running") && !loadingLast;
  const showResults = job && job.status !== "running";

  const dialog = (
    <div className={`bench-overlay${visible ? " is-open" : ""}`} role="presentation">
      {/* Scrim — click to close when not running */}
      <button
        type="button"
        className="bench-overlay__scrim"
        aria-label="关闭对话框"
        onClick={() => {
          if (!isRunning) onClose();
        }}
      />

      <div
        className="bench-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bench-title"
      >
        <header className="bench-sheet__header">
          <div className="bench-sheet__header-text">
            <h2 id="bench-title" className="bench-sheet__title">
              解码基准测试
            </h2>
            <p className="bench-sheet__subtitle">
              {remoteTarget
                ? formatLlmBaseUrl(remoteTarget)
                : `Port ${llmPort}`}
              {modelId ? ` · ${modelId}` : ""}
            </p>
          </div>
          <button
            type="button"
            className="bench-sheet__close"
            onClick={onClose}
            aria-label="关闭"
          >
            ✕
          </button>
        </header>

        <div className="bench-sheet__body">
          {loadingLast && !job && (
            <p className="bench-sheet__hint">正在加载上次结果…</p>
          )}

          {showConfig && (
            <section className="bench-sheet__section">
              <div className="bench-field">
                <div className="bench-field__head">
                  <h3 className="bench-sheet__section-title">类型</h3>
                  <p className="bench-sheet__hint">
                    {DECODE_BENCH_TYPE_META.find((t) => t.id === promptType)?.hint}
                    {"· 温度 0，关闭思考"}
                  </p>
                </div>
                <div
                  className="bench-type-grid"
                  role="radiogroup"
                  aria-label="解码基准测试类型"
                >
                  {DECODE_BENCH_TYPE_META.map((t) => {
                    const on = promptType === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        title={t.hint}
                        disabled={isRunning || starting}
                        onClick={() => setPromptType(t.id)}
                        className={`bench-conc-btn${on ? " is-on" : ""}`}
                      >
                        {t.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="bench-field">
                <div className="bench-field__head">
                  <h3 className="bench-sheet__section-title">并发数</h3>
                  <p className="bench-sheet__hint">
                    各档位依次运行，每个档位开启对应数量的并行流。
                  </p>
                </div>
                <div className="bench-conc-grid">
                  {CONCURRENCY_OPTIONS.map((n) => {
                    const on = selected.includes(n);
                    return (
                      <button
                        key={n}
                        type="button"
                        disabled={isRunning || starting}
                        onClick={() => toggleConcurrency(n)}
                        className={`bench-conc-btn${on ? " is-on" : ""}`}
                      >
                        {n}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="bench-field">
                <div className="bench-field__head">
                  <label htmlFor="bench-max-tokens" className="bench-sheet__section-title">
                    每条流最大 Token 数
                  </label>
                  <p className="bench-sheet__hint">
                    默认 400 · 温度 0，关闭思考
                    {promptType === "structured" ? "· 数量 1→200" : ""}
                  </p>
                </div>
                <input
                  id="bench-max-tokens"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  disabled={isRunning || starting}
                  value={maxTokensDraft}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw === "" || /^\d+$/.test(raw)) setMaxTokensDraft(raw);
                  }}
                  className="bench-input"
                  size={6}
                />
              </div>
            </section>
          )}

          {error && <p className="bench-sheet__error">{error}</p>}

          {job && job.status === "running" && (
            <section className="bench-sheet__section">
              <div className="bench-progress">
                <div className="bench-progress__row">
                  <span className="bench-progress__status">
                    运行中
                    {job.config?.promptType
                      ? ` · ${decodeBenchTypeLabel(job.config.promptType)}`
                      : ""}
                    {job.progress.currentConcurrency != null
                      ? ` · ×${job.progress.currentConcurrency}`
                      : ""}
                  </span>
                  <span className="bench-progress__meta">
                    {job.progress.completedLevels}/{job.progress.totalLevels}
                    {job.durationMs != null ? ` · ${formatDuration(job.durationMs)}` : ""}
                  </span>
                </div>
                <div className="bench-progress__track">
                  <div
                    className="bench-progress__fill"
                    style={{ width: `${Math.min(100, progressPct)}%` }}
                  />
                </div>
                {job.progress.message ? (
                  <p className="bench-sheet__hint">{job.progress.message}</p>
                ) : null}
              </div>
              {job.results.length > 0 && (
                <div className="bench-results">
                  <div className="bench-results__caption">已完成的并发档位</div>
                  {job.results.map((r) => (
                    <ResultRow key={r.concurrency} r={r} />
                  ))}
                </div>
              )}
            </section>
          )}

          {showResults && (
            <section className="bench-sheet__section">
              <div className="bench-status-row">
                <span
                  className={`bench-status-pill bench-status-pill--${job.status}`}
                >
                  {statusLabel(job.status)}
                </span>
                <span className="bench-status-meta">
                  {decodeBenchTypeLabel(job.config.promptType)} · {job.config.maxTokens} tok ·{" "}
                  {job.config.concurrencies.join(", ")} 并发
                  {job.durationMs != null ? ` · ${formatDuration(job.durationMs)}` : ""}
                </span>
              </div>

              {job.error && <p className="bench-sheet__error">{job.error}</p>}

              {job.results.length > 0 && (
                <div className="bench-results bench-results--table">
                  <div className="bench-results__head" aria-hidden="true">
                    <span>载入</span>
                    <span className="bench-results__head-speeds">
                      <span>合计</span>
                      <span>流</span>
                    </span>
                  </div>
                  {job.results.map((r) => (
                    <ResultRow key={r.concurrency} r={r} />
                  ))}
                </div>
              )}

              {job.results.length > 0 && (
                <p className="bench-legend">
                  <strong>合计</strong> — 所有并发流的解码总吞吐量（tok/s）。{" "}
                  <strong>流</strong> — 每条流的平均解码吞吐量。
                </p>
              )}
            </section>
          )}
        </div>

        <footer className="bench-sheet__footer">
          {job?.status === "running" ? (
            <button type="button" className="bench-btn bench-btn--ghost" onClick={() => void handleCancel()}>
              取消
            </button>
          ) : job ? (
            <>
              {job.results.length > 0 && (
                <button
                  type="button"
                  className="bench-btn bench-btn--ghost"
                  onClick={() => void handleClear()}
                  title="清除此端口已保存的结果"
                >
                  清除
                </button>
              )}
              {job.results.length > 0 && (
                <button
                  type="button"
                  className="bench-btn bench-btn--ghost"
                  onClick={() => void handleCopyResults()}
                  title="将纯文本摘要复制到剪贴板"
                >
                  {copied ? "已复制！" : "复制结果"}
                </button>
              )}
              <button type="button" className="bench-btn bench-btn--ghost" onClick={handleNewRun}>
                新建运行
              </button>
              <button type="button" className="bench-btn bench-btn--primary" onClick={onClose}>
                完成
              </button>
            </>
          ) : (
            <>
              <button type="button" className="bench-btn bench-btn--ghost" onClick={onClose}>
                关闭
              </button>
              <button
                type="button"
                className="bench-btn bench-btn--primary"
                onClick={() => void handleStart()}
                disabled={starting || selected.length === 0}
              >
                {starting ? "正在启动…" : "运行基准测试"}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}
