import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { addSpark, testSparkConfig } from "../api/client";
import type { SparkConfig, SparkTestResponse } from "../api/types";
import { useModalPresence } from "../hooks/useModalPresence";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { ConnectivityResult } from "./ui/ConnectivityResult";

interface AddSparkDialogProps {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
  defaultLlmPort?: number;
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);
}

const defaultConfig: Omit<SparkConfig, "id"> = {
  name: "",
  kind: "spark",
  lanIp: "",
  cx7Ip: "",
  isLocal: false,
  llmPorts: [8888],
  ssh: { host: "", user: "zurih", auth: "key" },
};

export function AddSparkDialog({ open, onClose, onAdded, defaultLlmPort = 8888 }: AddSparkDialogProps) {
  const [config, setConfig] = useState(defaultConfig);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<SparkTestResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [portsText, setPortsText] = useState(String(defaultLlmPort));
  const busy = testing || saving;
  const parsedPorts = portsText.trim() ? portsText.split(",").map((value) => {
    const text = value.trim();
    return /^\d+$/.test(text) ? Number(text) : NaN;
  }) : [defaultLlmPort];
  const portsValid = parsedPorts.every((port) => Number.isInteger(port) && port >= 1 && port <= 65535);

  useEscape(() => { if (open && !busy) onClose(); });

  const { mounted, visible } = useModalPresence(open);
  const trapRef = useFocusTrap(mounted);

  useEffect(() => {
    if (!mounted) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mounted]);

  // Pre-fill LLM ports from settings when dialog opens
  useEffect(() => {
    if (open) {
      setConfig((prev) => ({ ...prev, llmPorts: [defaultLlmPort] }));
      setPortsText(String(defaultLlmPort));
      setTestResult(null);
      setError(null);
    }
  }, [open, defaultLlmPort]);

  if (!mounted) return null;

  const update = (patch: Partial<Omit<SparkConfig, "id">>) => {
    setTestResult(null);
    setError(null);
    setConfig((prev) => ({ ...prev, ...patch }));
  };

  const updateSsh = (patch: Partial<SparkConfig["ssh"]>) => {
    setTestResult(null);
    setError(null);
    setConfig((prev) => ({ ...prev, ssh: { ...prev.ssh, ...patch } }));
  };

  const buildPayload = (): SparkConfig => {
    if (!portsValid) throw new Error("端口须为 1–65535 的整数，多个端口用英文逗号分隔。");
    const id = config.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || `spark-${Date.now()}`;
    const auth = config.ssh.auth;
    if (!config.isLocal && auth === "pass" && !config.ssh.password) {
      throw new Error("使用 SSH 密码认证时，请填写密码。");
    }
    return {
      ...config,
      name: config.name.trim(),
      lanIp: config.lanIp.trim(),
      llmPorts: [...new Set(parsedPorts)],
      id,
      ssh: {
        ...config.ssh,
        // Always set host from lanIp when empty
        host: config.ssh.host.trim() || config.lanIp.trim(),
      },
    };
  };

  const handleTest = async () => {
    if (busy) return;
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      const payload = buildPayload();
      // Ephemeral test — no registry mutation
      const result = await testSparkConfig(payload);
      setTestResult(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (busy) return;
    setSaving(true);
    setError(null);
    try {
      const payload = buildPayload();
      await addSpark(payload);
      onAdded();
      setConfig(defaultConfig);
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className={`modal-overlay${visible ? " is-open" : ""}`}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={trapRef}
        className="modal-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-spark-title"
      >
        <div className="modal-sheet__header" id="add-spark-title">
          添加 Spark／GPU 主机
        </div>

        <div className="modal-sheet__body">
        <fieldset disabled={busy} className="space-y-3 min-w-0 border-0 p-0 m-0">
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
              placeholder="我的 Spark"
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
              placeholder="192.168.1.100"
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
                placeholder="10.0.0.1"
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs text-muted">模型端口（可选，逗号分隔）</label>
            <input
              type="text"
              aria-label="模型端口"
              aria-invalid={!portsValid}
              aria-describedby={!portsValid ? "add-ports-error" : undefined}
              value={portsText}
              onChange={(e) => {
                setPortsText(e.target.value);
                setTestResult(null);
                setError(null);
              }}
              className="w-full rounded border border-border bg-surface-elevated px-3 py-1.5 text-xs text-text outline-none focus:border-accent"
              placeholder={String(defaultLlmPort)}
            />
            {!portsValid && <p id="add-ports-error" role="alert" className="mt-1 text-xs text-danger">端口须为 1–65535 的整数，多个端口用英文逗号分隔。</p>}
            <p className="mt-1 text-[10px] text-muted">
              默认： {defaultLlmPort}
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
                    SSH 从 sparkDash 主机发起，不是浏览器。Docker 中需挂载私钥至 /root/.ssh/id_ed25519，或设置 SSH_IDENTITY_FILE。IP 必须从该主机可达；本机采集请勾选“本机”以跳过 SSH。
                  </p>
                )}
              </div>

              {config.ssh.auth === "pass" && (
                <div>
                  <label className="mb-1 block text-xs text-muted">SSH 密码</label>
                  <input
                    type="password"
                    value={config.ssh.password || ""}
                    onChange={(e) => updateSsh({ password: e.target.value })}
                    className="w-full rounded border border-border bg-surface-elevated px-3 py-1.5 text-xs text-text outline-none focus:border-accent"
                    autoComplete="new-password"
                  />
                  <p className="mt-1 text-[10px] text-muted">
                    在服务端加密保存，不写入 sparks.json，也不会由 API 返回；Docker 重启后仍保留。
                  </p>
                </div>
              )}
            </>
          )}
        </fieldset>

        {testResult && <ConnectivityResult result={testResult} />}

        {error && (
          <div role="alert" className="mt-3 rounded bg-danger/20 px-3 py-2 text-xs text-danger">{error}</div>
        )}
        </div>

        <div className="modal-sheet__footer">
          <div className="modal-sheet__footer-actions" style={{ marginLeft: "auto" }}>
            <button
              type="button"
              onClick={handleTest}
              disabled={busy || !portsValid || (!config.isLocal && !config.lanIp.trim())}
              className="rounded border border-border bg-surface-elevated px-3 py-1.5 text-xs text-muted hover:bg-surface-hover disabled:opacity-50"
            >
              {testing ? "正在测试…" : "测试连接"}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded border border-border bg-surface-elevated px-3 py-1.5 text-xs text-muted hover:bg-surface-hover"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={busy || !portsValid || !config.name.trim() || (!config.isLocal && !config.lanIp.trim())}
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
