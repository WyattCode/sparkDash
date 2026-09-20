import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { fetchHermesUpdates, updateHermes } from "../../api/client";
import type { HermesUpdatesResponse } from "../../api/types";
import { useModalPresence } from "../../hooks/useModalPresence";
import {
  closeHermesUpdateDialog,
  useHermesUpdateDialog,
} from "../../hooks/useHermesUpdateDialog";
import { ExternalLinkIcon, RotateIcon } from "../ui/icons";

function useEscape(enabled: boolean, onClose: () => void) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [enabled, onClose]);
}

// ─── Changelog rendering (dependency-free markdown subset) ─────────
// Renders only the structure GitHub auto-generates for release bodies:
// headings, lists, code fences, blockquotes, paragraphs with bold/italic,
// inline code and links. Everything else is escaped text — never raw HTML.

const INLINE_RE =
  /(`[^`\n]+`)|(\*\*([^*\n]+)\*\*)|(\*([^*\n]+)\*)|(\[([^\]\n]*)\]\((https?:\/\/[^)\s]+)\))|(https?:\/\/[^\s<>()"'\]\[]+)/g;

function parseInline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  const re = new RegExp(INLINE_RE.source, "g");
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const [full, code, , bold, , italic, , linkText, linkUrl, bareUrl] = m;
    if (code) {
      nodes.push(
        <code key={`${keyBase}-c${k}`} className="rounded bg-surface-elevated px-1 py-0.5 font-mono text-[10px] text-text">
          {code.slice(1, -1)}
        </code>
      );
    } else if (bold) {
      nodes.push(<strong key={`${keyBase}-b${k}`}>{bold}</strong>);
    } else if (italic) {
      nodes.push(<em key={`${keyBase}-i${k}`}>{italic}</em>);
    } else if (linkUrl) {
      nodes.push(
        <a
          key={`${keyBase}-l${k}`}
          href={linkUrl}
          target="_blank"
          rel="noreferrer"
          className="text-accent underline decoration-accent/40 hover:decoration-accent"
        >
          {linkText || linkUrl}
        </a>
      );
    } else if (bareUrl) {
      nodes.push(
        <a
          key={`${keyBase}-u${k}`}
          href={bareUrl}
          target="_blank"
          rel="noreferrer"
          className="break-all text-accent underline decoration-accent/40 hover:decoration-accent"
        >
          {bareUrl}
        </a>
      );
    }
    k++;
    last = m.index + full.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function ChangelogBody({ body }: { body: string }) {
  const blocks = useMemo(() => {
    const out: ReactNode[] = [];
    const lines = body.replace(/\r\n?/g, "\n").slice(0, 40000).split("\n");
    let codeLines: string[] | null = null;
    let listType: "ul" | "ol" | null = null;
    let items: ReactNode[] = [];
    let para: string[] | null = null;
    let key = 0;
    let sentinel = 0;

    const flushPara = () => {
      if (para && para.length > 0) {
        out.push(
          <p key={`p${key}-${sentinel++}`} className="text-xs leading-relaxed text-muted">
            {parseInline(para.join(" "), `p${key}-${sentinel}`)}
          </p>
        );
        para = null;
      }
    };
    const flushList = () => {
      if (items.length > 0) {
        out.push(
          listType === "ol" ? (
            <ol key={`o${key}-${sentinel++}`} className="list-decimal space-y-1 pl-4 text-xs leading-relaxed text-muted">
              {items}
            </ol>
          ) : (
            <ul key={`u${key}-${sentinel++}`} className="list-disc space-y-1 pl-4 text-xs leading-relaxed text-muted">
              {items}
            </ul>
          )
        );
        items = [];
      }
      listType = null;
    };

    for (const raw of lines) {
      key++;
      if (key > 600) break;
      const line = raw.trim();

      // Fenced code block
      if (/^```/.test(line)) {
        flushPara();
        flushList();
        if (codeLines !== null) {
          out.push(
            <pre key={`pre${key}`} className="overflow-x-auto rounded-md border border-border bg-surface-elevated p-2">
              <code className="font-mono text-[10px] leading-relaxed text-text">
                {codeLines.join("\n")}
              </code>
            </pre>
          );
          codeLines = null;
        } else {
          codeLines = [];
        }
        continue;
      }
      if (codeLines !== null) {
        codeLines.push(line);
        continue;
      }

      if (!line) {
        flushPara();
        flushList();
        continue;
      }

      // Headings
      const h = /^(#{1,4})\s+(.*)$/.exec(line);
      if (h) {
        flushPara();
        flushList();
        const content = parseInline(h[2], `h${key}`);
        if (h[1].length <= 2) {
          out.push(
            <h2 key={`h2${key}`} className="mt-3 text-xs font-semibold uppercase tracking-wide text-text-strong">
              {content}
            </h2>
          );
        } else if (h[1].length === 3) {
          out.push(
            <h3 key={`h3${key}`} className="mt-2 text-xs font-semibold text-text-strong">
              {content}
            </h3>
          );
        } else {
          out.push(
            <h4 key={`h4${key}`} className="mt-2 text-[11px] font-semibold text-text-strong">
              {content}
            </h4>
          );
        }
        continue;
      }

      // Horizontal rule
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
        flushPara();
        flushList();
        out.push(<hr key={`hr${key}`} className="border-border" />);
        continue;
      }

      // Blockquote
      const bq = /^>\s?(.*)$/.exec(line);
      if (bq) {
        flushPara();
        flushList();
        out.push(
          <blockquote key={`bq${key}`} className="border-l-2 border-accent/40 pl-2 text-xs text-muted">
            {parseInline(bq[1], `bq${key}`)}
          </blockquote>
        );
        continue;
      }

      // Unordered list (incl. task lists)
      const ul = /^[-*•]\s+(.*)$/.exec(line);
      if (ul) {
        flushPara();
        if (listType !== "ul") {
          flushList();
          listType = "ul";
        }
        const marker = /^\[([ xX])\]\s+/.exec(ul[1]);
        const content = marker
          ? (marker[1] === "x" || marker[1] === "X" ? "☑ " : "☐ ") + ul[1].slice(marker[0].length)
          : ul[1];
        items.push(<li key={`li${key}`}>{parseInline(content, `li${key}`)}</li>);
        continue;
      }

      // Ordered list
      const ol = /^\d+[.)]\s+(.*)$/.exec(line);
      if (ol) {
        flushPara();
        if (listType !== "ol") {
          flushList();
          listType = "ol";
        }
        items.push(<li key={`li${key}`}>{parseInline(ol[1], `li${key}`)}</li>);
        continue;
      }

      // Plain paragraph line
      flushList();
      if (!para) para = [];
      para.push(line);
    }
    flushPara();
    flushList();
    if (codeLines !== null) {
      out.push(
        <pre key="pre-end" className="overflow-x-auto rounded-md border border-border bg-surface-elevated p-2">
          <code className="font-mono text-[10px] leading-relaxed text-text">
            {codeLines.join("\n")}
          </code>
        </pre>
      );
    }
    return out;
  }, [body]);

  return <div className="space-y-2">{blocks}</div>;
}

// ─── Dialog ──────────────────────────────────────────────────────────

function PendingCommitsList({ upd }: { upd: HermesUpdatesResponse }) {
  const pending = upd.pending;
  const commits = pending?.commits ?? [];
  return (
    <div className="max-h-[45vh] overflow-y-auto rounded-md border border-border bg-surface-elevated/40 p-3">
      <ul className="space-y-1.5">
        {commits.map((c) => (
          <li key={c.sha} className="flex items-start gap-2 text-xs leading-relaxed text-muted">
            <span className="shrink-0 font-mono font-tabular text-[10px] text-accent">
              {c.sha.slice(0, 8)}
            </span>
            <span className="min-w-0 break-words">{c.title}</span>
          </li>
        ))}
      </ul>
      {pending && pending.count > commits.length && (
        <p className="mt-2 text-[10px] text-muted">
          …以及 {pending.count - commits.length} 项更多（当前显示前 {commits.length}).
        </p>
      )}
    </div>
  );
}

export function HermesUpdateDialog() {
  const target = useHermesUpdateDialog();
  const open = target !== null;
  const { mounted, visible } = useModalPresence(open);
  const [upd, setUpd] = useState<HermesUpdatesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);

  useEscape(open, closeHermesUpdateDialog);

  // Prevent background scroll while open
  useEffect(() => {
    if (!mounted) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mounted]);

  // Fetch the update preview whenever the dialog (re)opens
  useEffect(() => {
    if (!open || !target) {
      setUpd(null);
      setLoading(false);
      setError(null);
      setUpdating(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchHermesUpdates(target.sparkId)
      .then((res) => {
        if (!cancelled) setUpd(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, target]);

  const handleUpdateNow = async () => {
    if (!target || updating) return;
    setUpdating(true);
    setError(null);
    try {
      await updateHermes(target.sparkId);
      closeHermesUpdateDialog();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setUpdating(false);
    }
  };

  if (!mounted) return null;

  const targetName = upd?.release?.name || upd?.release?.tagName || "latest release";

  return createPortal(
    <div
      className={`modal-overlay${visible ? " is-open" : ""}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) closeHermesUpdateDialog();
      }}
    >
      <div
        className="modal-sheet modal-sheet--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hermes-update-dialog-title"
      >
        <div className="modal-sheet__header" id="hermes-update-dialog-title">
          <div className="flex items-center gap-2">
            <RotateIcon className="h-4 w-4 shrink-0 text-accent" />
            <span>更新 Hermes 代理</span>
          </div>
          <p className="mt-1 text-[11px] font-normal text-muted">
            {target?.sparkName}
            {target?.currentVersion ? ` · installed v${target.currentVersion}` : ""}
          </p>
        </div>

        <div className="modal-sheet__body">
          {loading && (
            <div className="flex items-center gap-2 text-xs text-muted">
              <RotateIcon className="h-3.5 w-3.5 animate-spin text-accent" />
              正在加载版本说明…
            </div>
          )}

          {error && !loading && (
            <div className="rounded-md border border-danger/35 bg-danger/10 px-3 py-2.5">
              <p className="text-[11px] font-medium text-danger">
                无法加载更新日志，仍可手动更新。
              </p>
              <p className="mt-1 break-words text-[11px] text-muted">{error}</p>
              <div className="mt-2 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    if (!target) return;
                    setError(null);
                    setLoading(true);
                    fetchHermesUpdates(target.sparkId)
                      .then(setUpd)
                      .catch((err: unknown) =>
                        setError(err instanceof Error ? err.message : String(err))
                      )
                      .finally(() => setLoading(false));
                  }}
                  className="rounded-md border border-border bg-surface-elevated px-2.5 py-1 text-[11px] text-muted hover:bg-surface-hover hover:text-text"
                >
                  重试
                </button>
                <a
                  href="https://github.com/NousResearch/hermes-agent/releases"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
                >
                  打开版本发布页面
                  <ExternalLinkIcon className="h-3 w-3" />
                </a>
              </div>
            </div>
          )}

          {upd && !loading && upd.view === "commits" && upd.pending?.commits?.length ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-accent/15 px-1.5 py-0.5 font-tabular text-[11px] font-medium text-accent">
                  {upd.pending.count} 个提交落后于 main
                </span>
                {upd.installedVersion && (
                  <span className="text-[11px] text-muted">（已安装 v{upd.installedVersion})</span>
                )}
                {upd.release && upd.release.semver && (
                  <a
                    href={upd.release.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
                    title={`这些提交晚于发行版 v${upd.release.semver}`}
                  >
                    查看版本说明（v{upd.release.semver})
                    <ExternalLinkIcon className="h-3 w-3" />
                  </a>
                )}
              </div>
              <p className="text-[11px] leading-relaxed text-muted">
                这些提交尚无对应版本标签；此次仅在以下版本基础上更新这些改动：v{upd.installedVersion ?? "当前安装"}；完整版本更新日志不适用于此次更新。
              </p>
              <PendingCommitsList upd={upd} />
            </div>
          ) : upd && !loading && upd.release ? (
            <div className="space-y-3">
              {upd.pending?.commits?.length ? (
                <p className="text-[11px] text-muted">
                  此次更新还包括 {upd.pending.count} 个提交
                  {upd.pending.count === 1 ? "" : "s"} 基于下方版本的额外改动。
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-accent/15 px-1.5 py-0.5 font-tabular text-[11px] font-medium text-accent">
                  {targetName}
                </span>
                {target?.currentVersion && (
                  <span className="text-[11px] text-muted">
                    （已安装 v{target.currentVersion})
                  </span>
                )}
                {upd.release.publishedAt && (
                  <span className="font-tabular text-[10px] text-muted">
                    {new Date(upd.release.publishedAt).toLocaleDateString()}
                  </span>
                )}
                <a
                  href={upd.release.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
                  title="在 GitHub 查看此版本"
                >
                  在 GitHub 查看
                  <ExternalLinkIcon className="h-3 w-3" />
                </a>
              </div>
              <div className="max-h-[45vh] overflow-y-auto rounded-md border border-border bg-surface-elevated/40 p-3">
                {upd.release.body ? (
                  <ChangelogBody body={upd.release.body} />
                ) : (
                  <p className="text-xs text-muted">此版本没有发行说明。</p>
                )}
              </div>
            </div>
          ) : upd && !loading ? (
            <div className="rounded-md border border-danger/35 bg-danger/10 px-3 py-2.5">
              <p className="text-[11px] font-medium text-danger">
                无法确认此次更新的内容，仍可手动更新。
              </p>
              <p className="mt-1 break-words text-[11px] text-muted">
                {upd.releaseError ?? "没有可用的发行版或提交信息。"}
              </p>
            </div>
          ) : null}
        </div>

        <div className="modal-sheet__footer">
          <p className="text-[10px] text-muted">
            运行记录 <code className="rounded bg-surface-elevated px-1 font-mono">hermes update</code> on{" "}
            {target?.sparkName} 通过 SSH。
          </p>
          <div className="modal-sheet__footer-actions">
            <button
              type="button"
              onClick={closeHermesUpdateDialog}
              disabled={updating}
              className="rounded-md border border-border bg-surface-elevated px-3 py-1.5 text-xs text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void handleUpdateNow()}
              disabled={updating}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {updating ? (
                <>
                  <RotateIcon className="h-3 w-3 animate-spin" />
                  正在更新…
                </>
              ) : (
                "立即更新"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
