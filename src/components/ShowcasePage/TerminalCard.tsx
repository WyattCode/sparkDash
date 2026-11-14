import { useEffect, useRef, useState } from "react";
import { translateApiError } from '../../i18n/apiErrors';

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
  prompt?: string;
  decodeTps?: number;
  tokenCount?: number;
  ttftMs?: number | null;
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
  prompt,
  decodeTps = 0,
  tokenCount = 0,
  ttftMs = null,
}: TerminalCardProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  // Follow live output; saved results must open at the beginning, not the end.
  const stickToBottom = useRef(status === 'pending' || status === 'streaming');
  const [reasoningOpen, setReasoningOpen] = useState(true);
  const hasReasoning = Boolean(reasoning);
  const scrollKey = `${reasoning.length}:${content.length}:${error ?? ""}`;

  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !stickToBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [scrollKey, reasoningOpen]);

  const rate = status === 'streaming' ? liveTokPerSec : decodeTps;
  const empty = !content && !reasoning;

  return (
    <article className="showcase-term">
      <header className="showcase-term__header">
        <span className="showcase-term__label" title={label}>
          {label || "终端"}
        </span>
        <span className={`showcase-term__status ${statusClass(status)}`}>{({pending:'等待中',streaming:'生成中',completed:'已完成',error:'失败',cancelled:'已停止'} as Record<string,string>)[status]||'未知状态'}</span>
        {onCopy && (
          <button
            type="button"
            className="showcase-term__copy"
            onClick={onCopy}
            title="复制此请求的结果"
            disabled={!content && !reasoning && !error}
          >
            {copied ? "已复制！" : "复制"}
          </button>
        )}
      </header>
      {prompt && <details className="sw-term-prompt"><summary>查看提示词</summary><p>{prompt}</p></details>}
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
        {empty&&status!=='pending'&&(!error||status==='cancelled')&&<p role="status" className="showcase-term__answer">{status==='streaming'?'正在等待首个令牌…':status==='cancelled'?'测试已停止，未收到输出。':status==='completed'?'本次运行已结束，未返回文本内容。':'暂无输出，请查看运行状态。'}</p>}
        {hasReasoning && (
          <div className="showcase-term__reasoning">
            <button
              type="button"
              className="showcase-term__reasoning-toggle"
              aria-expanded={reasoningOpen}
              onClick={() => setReasoningOpen((o) => !o)}
            >
              {reasoningOpen ? "收起思考过程" : "展开思考过程"}
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
        {error && status !== "cancelled" ? <pre className="showcase-term__error">{`[错误] ${translateApiError(error)}`}</pre> : null}
      </div>
      <footer className="showcase-term__footer">
        <span>{status === 'streaming' ? '当前' : '平均'} {status === 'pending' || (!rate && status !== 'streaming') ? '—' : rate.toFixed(1) + ' tok/s'}</span>
        <span>首字 {ttftMs == null ? '—' : (ttftMs / 1000).toFixed(2) + ' s'}</span>
        <span>{tokenCount.toLocaleString()} tok</span>
      </footer>
    </article>
  );
}
