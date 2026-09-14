import { useState } from "react";
import type { SparkSnapshot } from "../../api/types";
import { shutdownSpark, wakeSpark } from "../../api/client";
import { ConfirmShutdownDialog } from "../ConfirmShutdownDialog";
import { openHermesUpdateDialog } from "../../hooks/useHermesUpdateDialog";
import { EditIcon, PowerOffIcon, PowerOnIcon, RotateIcon } from "../ui/icons";

interface SparkActionsProps {
  spark: SparkSnapshot;
  onEdit?: () => void;
  /** Classes for the button-cluster wrapper (controls responsive visibility). */
  className?: string;
}

/**
 * Update Hermes / Shutdown·Wake / Edit action cluster.
 * Rendered twice: inline in the SparkHeader (desktop) and as a standalone row
 * just above "Resources" on mobile. Owning the shutdown dialog + transient
 * power message here keeps the two placements in sync.
 */
export function SparkActions({ spark, onEdit, className }: SparkActionsProps) {
  const online = spark.online;
  const [powerLoading, setPowerLoading] = useState(false);
  const [powerMsg, setPowerMsg] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  const [shutdownOpen, setShutdownOpen] = useState(false);

  const hermes = spark.hermes;
  const hermesRunning = hermes?.status === "running";

  function handleHermesUpdate() {
    openHermesUpdateDialog({
      sparkId: spark.id,
      sparkName: spark.name,
      currentVersion: hermes?.version ?? null,
    });
  }

  async function handleShutdown() {
    setPowerLoading(true);
    setPowerMsg(null);
    try {
      const res = await shutdownSpark(spark.id);
      setPowerMsg({ text: res.message || "关机命令已执行，仍需确认节点离线", tone: "ok" });
    } catch (err: unknown) {
      setPowerMsg({
        text: err instanceof Error ? err.message : "关机失败或结果未确认",
        tone: "err",
      });
      throw err;
    } finally {
      setPowerLoading(false);
      setTimeout(() => setPowerMsg(null), 5000);
    }
  }

  async function handleWake() {
    setPowerLoading(true);
    setPowerMsg(null);
    try {
      const res = await wakeSpark(spark.id);
      setPowerMsg({ text: res.message || "唤醒数据包已发送", tone: "ok" });
    } catch (err: unknown) {
      setPowerMsg({
        text: err instanceof Error ? err.message : "唤醒失败",
        tone: "err",
      });
    } finally {
      setPowerLoading(false);
      setTimeout(() => setPowerMsg(null), 5000);
    }
  }

  return (
    <>
      <div className={className}>
        {powerMsg && (
          <span className={`text-[11px] ${powerMsg.tone === "ok" ? "text-success" : "text-danger"}`}>
            {powerMsg.text}
          </span>
        )}
        {hermesRunning && (
          <span
            className="flex items-center gap-1.5 text-[11px] text-warning"
            title="正在通过 SSH 执行 hermes update，可能需要数分钟。"
          >
            <RotateIcon className="h-3 w-3" />
            Hermes 更新中…
          </span>
        )}
        {!hermesRunning && hermes?.monitoring && hermes.status === "error" && (
          <span
            className="max-w-[16rem] truncate text-[11px] text-danger"
            title={hermes.error || "Hermes 更新失败"}
          >
            Hermes 更新失败
          </span>
        )}
        {!hermesRunning && hermes?.monitoring && hermes.installed !== false && (
          <button
            type="button"
            onClick={() => void handleHermesUpdate()}
            disabled={powerLoading}
            title={
              hermes.updateAvailable === true
                ? `Run "hermes update" on this machine via SSH${
                    hermes.behindCommits ? ` (${hermes.behindCommits} commits behind)` : ""
                  }`
                : "查看 Hermes Agent 更新状态，并手动通过 SSH 更新此主机"
            }
            className={`flex items-center gap-1.5 rounded-md border bg-surface-elevated px-3 py-1.5 text-[11px] transition-colors disabled:opacity-50 ${
              hermes.updateAvailable === true
                ? "border-warning/40 text-warning hover:bg-warning/15"
                : "border-border text-muted hover:bg-surface-hover hover:text-text"
            }`}
          >
            <RotateIcon className="h-3 w-3" />
            更新 Hermes
            {hermes.updateAvailable === true && (
              <span
                className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[9px] font-bold leading-none text-white"
                title={
                  hermes.behindCommits != null
                    ? `${hermes.behindCommits} commit${hermes.behindCommits === 1 ? "" : "s"} behind`
                    : "有可用更新"
                }
              >
                {hermes.behindCommits != null ? hermes.behindCommits : "!"}
              </span>
            )}
          </button>
        )}
        {online ? (
          <button
            type="button"
            onClick={() => setShutdownOpen(true)}
            disabled={powerLoading}
            title="关机前检查宿主机脚本 /usr/local/bin/spark-shutdown 及权限"
            className="flex items-center gap-1.5 rounded-md border border-border bg-surface-elevated px-3 py-1.5 text-[11px] text-muted transition-colors hover:bg-danger/20 hover:text-danger disabled:opacity-50"
          >
            <PowerOffIcon className="h-3 w-3" />
            关机
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void handleWake()}
            disabled={powerLoading}
            title="局域网唤醒（在编辑节点中设置 MAC 地址）"
            className="flex items-center gap-1.5 rounded-md border border-border bg-surface-elevated px-3 py-1.5 text-[11px] text-muted hover:bg-success/20 hover:text-success transition-colors disabled:opacity-50"
          >
            <PowerOnIcon className="h-3 w-3" />
            唤醒
          </button>
        )}
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="flex items-center gap-1.5 rounded-md border border-border bg-surface-elevated px-3 py-1.5 text-[11px] text-muted hover:bg-surface-hover hover:text-text transition-colors"
          >
            <EditIcon className="h-3 w-3" />
            编辑
          </button>
        )}
      </div>

      <ConfirmShutdownDialog
        open={shutdownOpen}
        targets={[{id:spark.id,name:spark.name}]}
        onClose={() => setShutdownOpen(false)}
        onConfirm={handleShutdown}
        title={`关闭 ${spark.name}`}
        description={`确认关闭 ${spark.name}？需要宿主机已有的关机脚本和免密 sudo。命令回执不等于节点已离线；连接中断时执行结果未确认。`}
        confirmLabel="关机"
      />
    </>
  );
}
