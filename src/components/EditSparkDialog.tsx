import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  deleteSpark,
  fetchSparks,
  setSparkPassword,
  testSpark,
  testSparkConfig,
  updateSpark,
} from "../api/client";
import type { SparkConfig, SparkRole, SparkTestResponse } from "../api/types";
import { resolveSparkRole } from "../api/sparkRole";
import { useModalPresence } from "../hooks/useModalPresence";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { InfoIcon } from "./ui/icons";
import { ConnectivityResult } from "./ui/ConnectivityResult";

interface EditSparkDialogProps {
  open: boolean;
  sparkId: string | null;
  onClose: () => void;
  onSaved: () => void;
  onDeleted?: (id: string) => void;
}
const secondaryButton = "rounded border border-border bg-surface-elevated px-3 py-1.5 text-xs text-muted hover:bg-surface-hover disabled:opacity-50";

function useEscape(onClose: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);
}

export function EditSparkDialog(props: EditSparkDialogProps) {
  return <EditSparkSession key={`${props.open}:${props.sparkId}`} {...props} />;
}

function EditSparkSession({
  open,
  sparkId,
  onClose,
  onSaved,
  onDeleted,
}: EditSparkDialogProps) {
  const [config, setConfig] = useState<SparkConfig | null>(null);
  /** Snapshot of the Spark config as last fetched from the server. Used to
   *  detect form-vs-saved divergence so Test can target what the user is
   *  actually looking at (vs. the stored config the registered test route
   *  would read). */
  const [savedConfig, setSavedConfig] = useState<SparkConfig | null>(null);
  /** All Sparks — used for the worker head picker. */
  const [allSparks, setAllSparks] = useState<SparkConfig[]>([]);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<SparkTestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedPasswordNote, setSavedPasswordNote] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [portText, setPortText] = useState("8188");
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteWord, setDeleteWord] = useState("");
  const alive = useRef(true);
  const lock = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const busy = saving || testing || deleting;
  const portValid = !config?.comfyMonitoring || (/^\d+$/.test(portText) && Number(portText) >= 1 && Number(portText) <= 65535);
  const valid = !!config && !!config.name.trim() && (config.isLocal || !!config.lanIp.trim()) && portValid;
  const close = () => { if (open && !lock.current) onClose(); };

  useEscape(close);

  const { mounted, visible } = useModalPresence(open);
  const trapRef = useFocusTrap(mounted);
  useEffect(() => {
    if (confirmDelete) trapRef.current?.querySelector<HTMLInputElement>('[aria-label="移除确认节点 ID"]')?.focus();
  }, [confirmDelete, trapRef]);

  // Prevent background scroll while the tall form is open (iOS)
  useEffect(() => {
    if (!mounted) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mounted]);

  useEffect(() => {
    if (!open || !sparkId) {
      setConfig(null);
      setSavedConfig(null);
      setAllSparks([]);
      setPassword("");
      setTestResult(null);
      setError(null);
      setSavedPasswordNote(null);
      return;
    }
    let cancelled = false;
    setError(null);
    setConfig(null);
    setSavedConfig(null);
    setPassword("");
    setSavedPasswordNote(null);
    setTestResult(null);
    setConfirmDelete(false);
    setDeleteWord("");
    setLoading(true);
    fetchSparks()
      .then((res) => {
        if (cancelled) return;
        setAllSparks(res.sparks);
        const found = res.sparks.find((s) => s.id === sparkId) || null;
        setConfig(found);
        setSavedConfig(found);
        setPortText(String(found?.comfyPort ?? 8188));
        if (!found) setError("找不到节点");
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, sparkId, retry]);

  if (!mounted) return null;

  const role: SparkRole = resolveSparkRole(config ?? {});

  const update = (patch: Partial<SparkConfig>) => {
    setTestResult(null);
    setError(null);
    setConfig((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const setRole = (next: SparkRole) => {
    update({
      role: next,
      workerNode: next === "worker",
      // Leaving Worker: turn monitoring back on (worker forces it false in state).
      llmMonitoring: next === "worker" ? false : next === "head" ? true : true,
    });
  };

  const updateSsh = (patch: Partial<SparkConfig["ssh"]>) => {
    setTestResult(null);
    setError(null);
    setConfig((prev) => (prev ? { ...prev, ssh: { ...prev.ssh, ...patch } } : prev));
  };

  const needsPassword =
    !config?.isLocal && config?.ssh.auth === "pass" && !config.ssh.hasPassword && !password;

  /** Persist password immediately (host can be offline). */
  const persistPasswordIfEntered = async () => {
    if (!config || !password) return false;
    await setSparkPassword(config.id, password);
    if (!alive.current) return true;
    setConfig((prev) =>
      prev
        ? { ...prev, ssh: { ...prev.ssh, hasPassword: true } }
        : prev
    );
    setSavedPasswordNote("SSH 密码已加密保存；节点配置尚未确认保存。即使后续失败，密码也已更新。");
    setPassword(""); // clear field — keep as stored secret
    return true;
  };

  const handleTest = async () => {
    if (!config || !valid || lock.current) return;
    if (!config.isLocal && config.ssh.auth === "pass" && !config.ssh.hasPassword && !password) {
      setError("请先填写 SSH 密码。测试不会保存密码或配置。");
      return;
    }
    lock.current = true;
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      // Only unchanged configuration with no new password uses stored credentials.
      // Drafts use the non-persisting endpoint and never silently forward a saved
      // password to a changed host. The user must supply a password for that test.
      const formDirty =
        !savedConfig ||
        config.lanIp !== savedConfig.lanIp ||
        (config.cx7Ip ?? null) !== (savedConfig.cx7Ip ?? null) ||
        config.isLocal !== savedConfig.isLocal ||
        (config.ssh?.host || config.lanIp) !== (savedConfig.ssh?.host || savedConfig.lanIp) ||
        config.ssh?.user !== savedConfig.ssh?.user ||
        config.ssh?.auth !== savedConfig.ssh?.auth ||
        (config.kind ?? "spark") !== (savedConfig.kind ?? "spark") ||
        config.role !== savedConfig.role ||
        Boolean(config.llmMonitoring) !== Boolean(savedConfig.llmMonitoring) ||
        Boolean(config.comfyMonitoring) !== Boolean(savedConfig.comfyMonitoring) ||
        Boolean(config.hermesMonitoring) !== Boolean(savedConfig.hermesMonitoring) ||
        Boolean(config.tailscaleMonitoring) !== Boolean(savedConfig.tailscaleMonitoring) ||
        (config.comfyPort ?? 8188) !== (savedConfig.comfyPort ?? 8188);

      if (formDirty && !config.isLocal && config.ssh.auth === "pass" && !password) {
        throw new Error("配置已修改，请重新输入 SSH 密码以测试当前草稿；测试不会保存密码或配置。");
      }
      const result = formDirty || password
        ? await testSparkConfig({
            ...config,
            ssh: {
              ...config.ssh,
              host: config.ssh.host || config.lanIp,
              password,
            },
          })
        : await testSpark(config.id);

      if (!alive.current) return;
      setTestResult(result);
    } catch (err: unknown) {
      if (alive.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      lock.current = false;
      if (alive.current) setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!config || !valid || lock.current) return;
    if (!config.isLocal && config.ssh.auth === "pass" && !config.ssh.hasPassword && !password) {
      setError("密码认证需要填写密码，将加密保存，主机可以离线。");
      return;
    }
    lock.current = true;
    setSaving(true);
    setError(null);
    try {
      // Save password first so it is never lost if the rest of the update fails
      if (password) {
        await persistPasswordIfEntered();
        if (!alive.current) return;
      }

      const patch: Partial<SparkConfig> = {
        name: config.name.trim(),
        kind: config.kind ?? "spark",
        lanIp: config.lanIp.trim(),
        cx7Ip: config.cx7Ip,
        macAddress: config.macAddress || null,
        isLocal: config.isLocal,
        role,
        workerNode: role === "worker",
        workerLabel: role === "worker" ? (config.workerLabel?.trim() || null) : null,
        workerHeadId: role === "worker" ? (config.workerHeadId?.trim() || null) : null,
        llmMonitoring:
          role === "worker" ? false : role === "head" ? true : config.llmMonitoring !== false,
        comfyMonitoring: Boolean(config.comfyMonitoring),
        comfyPort: (() => {
          const n = Number(config.comfyPort);
          return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : 8188;
        })(),
        hermesMonitoring: Boolean(config.hermesMonitoring),
        tailscaleMonitoring: Boolean(config.tailscaleMonitoring),
        ssh: {
          host: config.ssh.host || config.lanIp,
          user: config.ssh.user,
          auth: config.ssh.auth,
        },
      };
      await updateSpark(config.id, patch);
      if (!alive.current) return;
      onSaved();
      onClose();
    } catch (err: unknown) {
      if (alive.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      lock.current = false;
      if (alive.current) setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!config || lock.current || !confirmDelete || deleteWord !== config.id) return;
    lock.current = true;
    setDeleting(true);
    setError(null);
    try {
      await deleteSpark(config.id);
      if (!alive.current) return;
      onDeleted?.(config.id);
      onClose();
    } catch (err: unknown) {
      if (alive.current) {
        setError(err instanceof Error ? err.message : String(err));
        setDeleteWord("");
      }
    } finally {
      lock.current = false;
      if (alive.current) setDeleting(false);
    }
  };

  return createPortal(
    <div
      className={`modal-overlay${visible ? " is-open" : ""}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={trapRef}
        tabIndex={-1}
        className="modal-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-spark-title"
      >
        <div className="modal-sheet__header" id="edit-spark-title">
          编辑节点
        </div>

        <div className="modal-sheet__body">
          {loading && <p className="text-xs text-muted">正在加载…</p>}

          {config && !loading && (
            <fieldset disabled={busy || confirmDelete} className="space-y-3 min-w-0 border-0 p-0 m-0">
              <div>
                <label className="mb-1 block text-xs text-muted">设备类型</label>
                <select
                  value={config.kind ?? "spark"}
                  onChange={(e) => update({ kind: e.target.value as "spark" | "host" })}
                  className="w-full rounded border border-border bg-surface-elevated px-3 py-1.5 text-xs text-text outline-none focus:border-accent"
                >
                  <option value="spark">NVIDIA DGX Spark</option>
                  <option value="host">独立 GPU 主机（Linux，支持 nvidia-smi，非 Spark）</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs text-muted">名称</label>
                <input
                  type="text"
                  value={config.name}
                  onChange={(e) => update({ name: e.target.value })}
                  className="w-full rounded border border-border bg-surface-elevated px-3 py-1.5 text-xs text-text outline-none focus:border-accent"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-muted">
                  局域网 IP {config.isLocal ? "（可选，用于浏览器链接和局域网唤醒）" : "（必填）"}
                </label>
                <input
                  type="text"
                  value={config.lanIp}
                  onChange={(e) => update({ lanIp: e.target.value })}
                  className="w-full rounded border border-border bg-surface-elevated px-3 py-1.5 text-xs text-text outline-none focus:border-accent"
                />
                {config.isLocal && !config.lanIp && (
                  <p className="mt-1 text-[10px] text-muted">
                    本机指标仍可采集；打开链接及定向局域网唤醒需要填写局域网 IP。
                  </p>
                )}
              </div>

              {config.kind !== "host" && (
                <div>
                  <label className="mb-1 block text-xs text-muted">CX7 IP（可选）</label>
                  <input
                    type="text"
                    value={config.cx7Ip || ""}
                    onChange={(e) => update({ cx7Ip: e.target.value || null })}
                    className="w-full rounded border border-border bg-surface-elevated px-3 py-1.5 text-xs text-text outline-none focus:border-accent"
                  />
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs text-muted">
                  MAC 地址（局域网唤醒覆盖值）
                </label>
                <input
                  type="text"
                  value={config.macAddress || ""}
                  onChange={(e) => update({ macAddress: e.target.value || null })}
                  placeholder={
                    config.detectedMacAddress
                      ? `自动：${config.detectedMacAddress}`
                      : "上线后自动读取 enP7s7"
                  }
                  className="w-full rounded border border-border bg-surface-elevated px-3 py-1.5 text-xs text-text outline-none focus:border-accent"
                />
                <p className="mt-1 text-[10px] text-muted">
                  {config.detectedMacAddress
                    ? `自动使用 enP7s7（${config.detectedMacAddress}）。留空保持自动，也可填写其他 MAC 地址。`
                    : "留空则在节点上线并被探测后使用 enP7s7。"}
                </p>
              </div>

              <label className="flex items-center gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={config.isLocal}
                  onChange={(e) => update({ isLocal: e.target.checked })}
                  className="rounded border-border"
                />
                本机（本地采集，无需 SSH）
              </label>

              <div>
                <label className="mb-1 flex items-center gap-1.5 text-xs text-muted">
                  <span>角色</span>
                  <span
                    className="inline-flex shrink-0 cursor-help text-muted hover:text-text"
                    title="主节点始终监控本机模型；独立节点可选。工作节点不探测本机模型 API，并隐藏对应卡片。"
                    aria-label="主节点始终监控本机模型；独立节点可选。工作节点隐藏模型卡片且不探测模型端口。"
                  >
                    <InfoIcon className="h-3.5 w-3.5" />
                  </span>
                </label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as SparkRole)}
                  className="w-full rounded border border-border bg-surface-elevated px-3 py-1.5 text-xs text-text outline-none focus:border-accent"
                >
                  <option value="head">主节点</option>
                  <option value="worker">工作节点</option>
                  <option value="standalone">独立节点</option>
                </select>
              </div>

              {role === "standalone" && (
                <label className="flex items-center gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={config.llmMonitoring !== false}
                    onChange={(e) => update({ llmMonitoring: e.target.checked })}
                    className="rounded border-border"
                  />
                  <span>LLM 监控</span>
                  <span
                    className="inline-flex shrink-0 cursor-help text-muted hover:text-text"
                    title="启用后探测本机模型 API，并显示此节点的模型卡片。"
                    aria-label="启用本机模型 API 探测并显示模型卡片。"
                  >
                    <InfoIcon className="h-3.5 w-3.5" />
                  </span>
                </label>
              )}

              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                <label className="flex min-w-0 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={Boolean(config.comfyMonitoring)}
                    onChange={(e) =>
                      update({
                        comfyMonitoring: e.target.checked,
                        comfyPort: config.comfyPort ?? 8188,
                      })
                    }
                    className="rounded border-border"
                  />
                  <span>ComfyUI 监控</span>
                  <span
                    className="inline-flex shrink-0 cursor-help text-muted hover:text-text"
                    title="启用后探测此主机的 ComfyUI 并显示卡片，默认端口为 8188，可按需修改。"
                    aria-label="启用 ComfyUI 探测并显示对应卡片。"
                  >
                    <InfoIcon className="h-3.5 w-3.5" />
                  </span>
                </label>
                {/* Compact “port 8188” control on the same row. */}
                <div
                  className={`ml-auto flex items-center gap-1 font-tabular ${
                    config.comfyMonitoring ? "text-text" : "pointer-events-none opacity-40"
                  }`}
                  title="ComfyUI HTTP 端口（默认 8188）"
                >
                  <span className="shrink-0 whitespace-nowrap select-none text-muted" aria-hidden>
                    端口
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    inputMode="numeric"
                    disabled={!config.comfyMonitoring}
                    aria-label="ComfyUI 端口"
                    value={portText}
                    aria-invalid={!portValid}
                    aria-describedby={!portValid ? "edit-port-error" : undefined}
                    onChange={(e) => {
                      setPortText(e.target.value);
                      update({ comfyPort: Number(e.target.value) });
                    }}
                    className="w-14 border-0 bg-transparent px-0.5 py-0.5 text-center font-tabular text-xs text-inherit outline-none focus:rounded focus:bg-surface-elevated focus:ring-1 focus:ring-accent disabled:cursor-not-allowed"
                  />
                </div>
              </div>

              {!portValid && <p id="edit-port-error" role="alert" className="text-xs text-danger">ComfyUI 端口须为 1–65535 的整数。</p>}

              <label className="flex items-center gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={Boolean(config.hermesMonitoring)}
                  onChange={(e) => update({ hermesMonitoring: e.target.checked })}
                  className="rounded border-border"
                />
                <span>Hermes 代理</span>
                <span
                  className="inline-flex shrink-0 cursor-help text-muted hover:text-text"
                  title="此主机已安装 Hermes Agent CLI。启用后检查更新（hermes update --check），并可手动通过 SSH 执行 hermes update。"
                  aria-label="此主机已安装 Hermes Agent CLI，可启用更新监控和手动更新入口。"
                >
                  <InfoIcon className="h-3.5 w-3.5" />
                </span>
              </label>
              <p className="mt-1 text-[10px] text-muted">
                每 10 分钟检查更新，并提供“更新 Hermes”按钮以执行{" "}
                <code className="rounded bg-surface-elevated px-1">hermes update</code> 通过 SSH 在此主机执行。
              </p>

              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                <label className="flex min-w-0 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={Boolean(config.tailscaleMonitoring)}
                    onChange={(e) => update({ tailscaleMonitoring: e.target.checked })}
                    className="rounded border-border"
                  />
                  <span>Tailnet 监控</span>
                  <span
                    className="inline-flex shrink-0 cursor-help text-muted hover:text-text"
                    title="启用后执行 tailscale status --json 并显示 Tailnet 卡片，可发现局域网正常但 Tailnet 离线的节点。需要 tailscale CLI，默认关闭。"
                    aria-label="启用此节点的 Tailnet 在线状态报告。"
                  >
                    <InfoIcon className="h-3.5 w-3.5" />
                  </span>
                </label>
              </div>

              {role === "worker" && (
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs text-muted">
                      工作节点标签（集群 / 模型）
                    </label>
                    <input
                      type="text"
                      value={config.workerLabel || ""}
                      onChange={(e) => update({ workerLabel: e.target.value || null })}
                      placeholder="例如 DeepSeek V4 Flash"
                      className="w-full rounded border border-border bg-surface-elevated px-3 py-1.5 text-xs text-text outline-none focus:border-accent"
                    />
                    <p className="mt-1 text-[10px] text-muted">
                      显示在概览卡片上，留空则显示“分布式”。
                    </p>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs text-muted">主节点</label>
                    <select
                      value={config.workerHeadId || ""}
                      onChange={(e) => update({ workerHeadId: e.target.value || null })}
                      className="w-full rounded border border-border bg-surface-elevated px-3 py-1.5 text-xs text-text outline-none focus:border-accent"
                    >
                      <option value="">无</option>
                      {config.workerHeadId &&
                        !allSparks.some((s) => s.id === config.workerHeadId) && (
                          <option value={config.workerHeadId}>
                            节点不存在（{config.workerHeadId})
                          </option>
                        )}
                      {allSparks
                        .filter((s) => s.id !== config.id)
                        .map((s) => {
                          const sRole = resolveSparkRole(s);
                          const suffix =
                            sRole === "head" ? "（主节点）" : sRole === "worker" ? "（工作节点）" : "";
                          return (
                            <option key={s.id} value={s.id}>
                              {s.name}{suffix}
                            </option>
                          );
                        })}
                    </select>
                    <p className="mt-1 text-[10px] text-muted">
                      可选，指定此工作节点对应的集群主节点。
                    </p>
                  </div>
                </div>
              )}

              {!config.isLocal && (
                <>
                  <div>
                    <label className="mb-1 block text-xs text-muted">SSH 用户</label>
                    <input
                      type="text"
                      value={config.ssh.user}
                      onChange={(e) => updateSsh({ user: e.target.value })}
                      className="w-full rounded border border-border bg-surface-elevated px-3 py-1.5 text-xs text-text outline-none focus:border-accent"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs text-muted">SSH 认证</label>
                    <select
                      value={config.ssh.auth}
                      onChange={(e) => updateSsh({ auth: e.target.value as "key" | "pass" })}
                      className="w-full rounded border border-border bg-surface-elevated px-3 py-1.5 text-xs text-text outline-none focus:border-accent"
                    >
                      <option value="key">密钥</option>
                      <option value="pass">密码</option>
                    </select>
                    {config.ssh.auth === "key" && (
                      <p className="mt-1 text-[10px] text-muted">
                        SSH 从 sparkDash 主机发起。Docker 中请挂载 /root/.ssh/id_ed25519 或配置 SSH_IDENTITY_FILE。IP 必须从该主机可达，并非从浏览器所在电脑访问。
                      </p>
                    )}
                  </div>

                  {config.ssh.auth === "pass" && (
                    <div>
                      <label className="mb-1 block text-xs text-muted">
                        SSH 密码
                        {config.ssh.hasPassword
                          ? "（留空保留已保存的密码）"
                          : "（必填，主机离线也会保存）"}
                      </label>
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => { setPassword(e.target.value); setTestResult(null); setError(null); }}
                        className="w-full rounded border border-border bg-surface-elevated px-3 py-1.5 text-xs text-text outline-none focus:border-accent"
                        autoComplete="new-password"
                        placeholder={config.ssh.hasPassword ? "••••••••" : "输入密码"}
                      />
                      {config.ssh.hasPassword ? (
                        <p className="mt-1 text-[10px] text-muted">
                          密码在服务器端加密保存；节点离线时仍保留，上线后可恢复连接。
                        </p>
                      ) : (
                        <p className="mt-1 text-[10px] text-warning">
                          测试仅使用当前草稿，不保存密码或配置；点击保存才会加密存储，主机无需在线。
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </fieldset>
          )}

          {testResult && <ConnectivityResult result={testResult} />}
          {savedPasswordNote && <p role="status" className="mt-2 text-xs text-warning">{savedPasswordNote}</p>}

          {error && (
            <div role="alert" className="mt-3 rounded bg-danger/20 px-3 py-2 text-xs text-danger">{error}</div>
          )}
          {!config && !loading && <button className={secondaryButton} onClick={() => setRetry(n => n + 1)}>重新加载节点</button>}
          {config && error && !busy && <button className={secondaryButton} onClick={() => setRetry(n => n + 1)}>放弃草稿并重新加载</button>}
          {confirmDelete && config && <div className="mt-3 space-y-3 rounded border border-danger/40 p-3">
            <p className="text-xs text-danger">确认从 sparkDash 移除“{config.name}”？将删除该节点配置及保存的凭据，并停止本控制台对它的采集；不会关机或停止模型。恢复监控需要重新添加节点。</p>
            <label className="block text-xs text-muted">输入节点 ID：<code>{config.id}</code>
              <input aria-label="移除确认节点 ID" value={deleteWord} disabled={busy} onChange={e => setDeleteWord(e.target.value)} className="mt-2 w-full rounded border border-border bg-surface-elevated px-3 py-2 text-text" />
            </label>
            <button className={secondaryButton} disabled={busy} onClick={() => { setConfirmDelete(false); setDeleteWord(""); setError(null); }}>返回编辑</button>
          </div>}
        </div>

        <div className="modal-sheet__footer">
          <button
            type="button"
            onClick={() => { if (confirmDelete) void handleDelete(); else { setConfirmDelete(true); setError(null); } }}
            disabled={busy || loading || !config || (confirmDelete && deleteWord !== config.id)}
            className="rounded border border-danger/40 bg-surface-elevated px-3 py-1.5 text-xs text-danger hover:bg-danger/10 disabled:opacity-50"
          >
            {deleting ? "正在移除…" : confirmDelete ? "确认移除" : "移除"}
          </button>
          <div className="modal-sheet__footer-actions">
            <button
              type="button"
              onClick={handleTest}
              disabled={busy || loading || !valid || confirmDelete || needsPassword}
              className="rounded border border-border bg-surface-elevated px-3 py-1.5 text-xs text-muted hover:bg-surface-hover disabled:opacity-50"
            >
              {testing ? "正在测试…" : "测试连接"}
            </button>
            <button
              type="button"
              onClick={close}
              disabled={busy}
              className="rounded border border-border bg-surface-elevated px-3 py-1.5 text-xs text-muted hover:bg-surface-hover"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={busy || loading || !valid || confirmDelete || needsPassword}
              className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {saving ? "正在保存…" : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
