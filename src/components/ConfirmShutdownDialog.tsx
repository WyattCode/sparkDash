import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useModalPresence } from "../hooks/useModalPresence";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { PowerOffIcon } from "./ui/icons";
import { fetchPowerReadiness, type PowerReadiness } from '../api/client';

const CONFIRM_PHRASE = "poweroff";

interface ConfirmShutdownDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description: string;
  confirmLabel?: string;
  targets: {id:string;name:string}[];
}

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

export function ConfirmShutdownDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "关机",
  targets,
}: ConfirmShutdownDialogProps) {
  const [phrase, setPhrase] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [readiness,setReadiness]=useState<(PowerReadiness & {id:string;name:string})[]|null>(null);
  const [checking,setChecking]=useState(false);
  const [retry,setRetry]=useState(0);
  const [now,setNow]=useState(Date.now());
  const [submitError,setSubmitError]=useState<string|null>(null);
  const targetKey=JSON.stringify(targets);
  useEffect(()=>{
    if(!open)return;
    let alive=true;
    setReadiness(null);setChecking(true);setSubmitError(null);
    const selected=JSON.parse(targetKey) as {id:string;name:string}[];
    void Promise.all(selected.map(async t=>{
      try{return {...await fetchPowerReadiness(t.id),...t};}
      catch{return {...t,ready:false,status:'unavailable' as const,message:'依赖检查失败，请确认节点连接后重试',checkedAt:Date.now()};}
    })).then(rows=>{if(alive){setReadiness(rows);setChecking(false);setNow(Date.now());}});
    const timer=setInterval(()=>setNow(Date.now()),1000);
    return()=>{alive=false;clearInterval(timer);};
  },[open,targetKey,retry]);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const { mounted, visible } = useModalPresence(open);
  const trapRef = useFocusTrap(mounted);

  useEscape(open && !submitting, onClose);

  useEffect(() => {
    if (!open) {
      setPhrase("");
      setAcknowledged(false);
      setSubmitting(false);
      return;
    }
    const t = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mounted]);

  const phraseOk = phrase.trim().toLowerCase() === CONFIRM_PHRASE;
  const ready=!!readiness?.length&&readiness.every(r=>r.ready&&Number.isFinite(r.checkedAt)&&now-r.checkedAt>=0&&now-r.checkedAt<30000);
  const canConfirm = phraseOk && acknowledged && !submitting && !checking && ready;

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onConfirm();
      onClose();
    } catch (error) {
      setSubmitting(false);
      setSubmitError(error instanceof Error?error.message:'执行失败或结果未确认，请检查节点状态');
      setReadiness(null);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <div
      className={`modal-overlay${visible ? " is-open" : ""}`}
      onClick={(e) => {
        if (submitting) return;
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={trapRef}
        className="modal-sheet max-w-md"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-sheet__header flex items-center gap-2 text-danger" id={titleId}>
          <PowerOffIcon className="h-4 w-4 shrink-0" />
          <span>危险操作 — {title}</span>
        </div>

        <div className="modal-sheet__body space-y-3">
          <p className="text-xs leading-relaxed text-muted">{description}</p>

          <div className="rounded border border-border bg-surface-elevated p-3 text-xs text-muted" role="status">
            <p>关机依赖检查（只读，不执行关机）</p>
            {checking?<p>正在检查脚本、权限和节点连接…</p>:readiness?.map(r=><p key={r.id} className="mt-1">{r.name}：{r.message}</p>)}
            {!checking&&!ready&&<p className="mt-1">未就绪或检查已过期，已禁止提交。</p>}
            <button type="button" className="mt-2 underline" disabled={checking||submitting} onClick={()=>setRetry(n=>n+1)}>重新检查依赖</button>
          </div>
          {submitError&&<p role="alert" className="text-xs text-danger">{submitError}</p>}

          <div className="rounded-md border border-danger/35 bg-danger/10 px-3 py-2.5">
            <p className="text-[11px] font-medium text-danger">
              此操作会关闭硬件，停止正在运行的容器与会话。
            </p>
          </div>

          <label className="flex cursor-pointer items-start gap-2.5 text-xs text-text">
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={submitting}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--color-danger)]"
            />
            <span>我了解此操作无法从控制面板撤销。</span>
          </label>

          <div>
            <label className="mb-1 block text-xs text-muted">
              输入 <span className="font-mono text-danger">{CONFIRM_PHRASE}</span> 确认
            </label>
            <input
              ref={inputRef}
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={phrase}
              disabled={submitting}
              onChange={(e) => setPhrase(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleConfirm();
                }
              }}
              className="w-full rounded border border-border bg-surface-elevated px-3 py-1.5 font-mono text-xs text-text outline-none focus:border-danger"
              placeholder={CONFIRM_PHRASE}
            />
          </div>
        </div>

        <div className="modal-sheet__footer">
          <div className="modal-sheet__footer-actions">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-md border border-border bg-surface-elevated px-3 py-1.5 text-xs text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={!canConfirm}
              className="rounded-md border border-danger/50 bg-danger px-3 py-1.5 text-xs font-medium text-white transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? "正在提交关机命令…" : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
