import { useEffect, useRef, useState } from "react";

export interface TerminalCardProps {
  label: string;
  status: string;
  liveTokPerSec: number;
  peakTokPerSec: number;
  content: string;
  reasoning: string;
  error: string | null;
  onCopy?: () => void;
  copied?: boolean;
}

function statusClass(status: string): string {
  switch (status) {
    case "streaming":
      return "showcase-term__status--streaming";
    case "completed":
      return "showcase-term__status--completed";
    case "error":
      return "showcase-term__status--error";
    case "cancelled":
      return "showcase-term__status--cancelled";
    default:
      return "showcase-term__status--pending";
  }
}

export function TerminalCard({
  label,
  status,
  liveTokPerSec,
  peakTokPerSec,
  content,
  reasoning,
  error,
  onCopy,
  copied,
}: TerminalCardProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [reasoningOpen, setReasoningOpen] = useState(true);
  const hasReasoning = Boolean(reasoning);
  const scrollKey = `${reasoning.length}:${content.length}:${error ?? ""}`;

  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !stickToBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [scrollKey, reasoningOpen]);

  const peak = Math.max(peakTokPerSec, liveTokPerSec, 1);
  const gaugePct = Math.min(100, (liveTokPerSec / peak) * 100);
  const empty = !content && !reasoning;

  return (
    <article className="showcase-term">
      <header className="showcase-term__header">
        <span className="showcase-term__label" title={label}>
          {label || "终端"}
        </span>
        <span className={`showcase-term__status ${statusClass(status)}`}>{({pending:'等待中',streaming:'生成中',completed:'已完成',error:'失败',cancelled:'已取消'} as Record<string,string>)[status]||'未知状态'}</span>
        <span
          className="showcase-term__tps font-tabular"
          title={
            peakTokPerSec > 0 || liveTokPerSec > 0
              ? `当前 ${liveTokPerSec.toFixed(1)} tok/s · 峰值 ${Math.max(peakTokPerSec, liveTokPerSec).toFixed(1)} tok/s`
              : undefined
          }
        >
          {liveTokPerSec > 0 || peakTokPerSec > 0 ? (
            <>
              {(liveTokPerSec > 0 ? liveTokPerSec : peakTokPerSec).toFixed(0)} tok/s
              {peakTokPerSec > 0 && (
                <span className="showcase-term__tps-peak">
                  {" "}
                  峰值 {Math.max(peakTokPerSec, liveTokPerSec).toFixed(0)}
                </span>
              )}
            </>
          ) : (
            "—"
          )}
        </span>
        {onCopy && (
          <button
            type="button"
            className="showcase-term__copy"
            onClick={onCopy}
            title="复制此终端"
          >
            {copied ? "已复制！" : "复制"}
          </button>
        )}
      </header>
      <div
        ref={bodyRef}
        className="showcase-term__body"
        onScroll={() => {
          const el = bodyRef.current;
          if (!el) return;
          stickToBottom.current =
            el.scrollHeight - el.scrollTop - el.clientHeight <= 64;
        }}
      >
        {empty && status === "pending" && (
          <pre className="showcase-term__answer">等待中…</pre>
        )}
        {empty&&status!=='pending'&&!error&&<p role="status" className="showcase-term__answer">{status==='streaming'?'正在等待首个 Token…':status==='cancelled'?'已取消，未收到输出。':status==='completed'?'本次运行已结束，未返回文本内容。':'暂无输出，请查看运行状态。'}</p>}
        {hasReasoning && (
          <div className="showcase-term__reasoning">
            <button
              type="button"
              className="showcase-term__reasoning-toggle"
              aria-expanded={reasoningOpen}
              onClick={() => setReasoningOpen((o) => !o)}
            >
              {reasoningOpen ? "▾" : "▸"} 思考
              <span className="showcase-term__reasoning-meta">
                {reasoning.length.toLocaleString()} 字符
              </span>
            </button>
            {reasoningOpen && (
              <pre className="showcase-term__reasoning-text">{reasoning}</pre>
            )}
          </div>
        )}
        {content ? (
          <pre className="showcase-term__answer">{content}</pre>
        ) : (
          !empty && status === "streaming" && !hasReasoning && (
            <pre className="showcase-term__answer">…</pre>
          )
        )}
        {error ? <pre className="showcase-term__error">{`[错误] ${error}`}</pre> : null}
      </div>
      <footer className="showcase-term__footer">
        <div className="showcase-gauge" aria-hidden="true">
          <div
            className="showcase-gauge__fill"
            style={{ ["--bar-pct" as string]: `${gaugePct}%` }}
          />
        </div>
      </footer>
    </article>
  );
}
