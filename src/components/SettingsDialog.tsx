import { useEffect, useId, useState } from "react";
import { fetchSettings, updateSettings } from "../api/client";
import type { Settings } from "../api/types";
import { useModalPresence } from "../hooks/useModalPresence";
import { useFocusTrap } from '../hooks/useFocusTrap';
import packageJson from "../../package.json";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: (settings: Settings) => void;
}

function useEscape(enabled:boolean, onClose: () => void) {
  useEffect(() => {
    if(!enabled)return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [enabled,onClose]);
}

const POLL_PRESETS = [
  { label: "1s", value: 1000 },
  { label: "2s", value: 2000 },
  { label: "5s", value: 5000 },
  { label: "10s", value: 10000 },
];

export function SettingsDialog({ open, onClose, onSaved }: SettingsDialogProps) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [retry,setRetry]=useState(0);

  useEscape(open&&!saving,onClose);
  const titleId=useId();

  useEffect(() => {
    if (!open) {
      setSettings(null);
      setError(null);
      setDirty(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchSettings()
      .then((s) => {
        if (!cancelled) setSettings(s);
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
  }, [open,retry]);

  const { mounted, visible } = useModalPresence(open);
  const trapRef=useFocusTrap(mounted);
  const portValid=!!settings&&Number.isInteger(settings.defaultLlmPort)&&settings.defaultLlmPort>=1&&settings.defaultLlmPort<=65535;

  const update = (patch: Partial<Settings>) => {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
  };

  const handleSave = async () => {
    if (!settings||saving) return;
    if(!portValid){setError('端口必须是 1–65535 之间的整数');return;}
    setSaving(true);
    setError(null);
    try {
      const result = await updateSettings(settings);
      setSettings(result);
      setDirty(false);
      onSaved(result);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!mounted) return null;

  return (
    <div
      className={`settings-overlay fixed inset-0 z-50 flex justify-center bg-black/55 p-0 sm:p-4${
        visible ? " is-open" : ""
      }`}
      onClick={(e) => {
        if (!saving&&e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={trapRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="settings-panel w-full max-w-sm">
        <h2 id={titleId} className="shrink-0 px-6 pt-6 text-sm font-semibold text-text-strong">设置</h2>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4">
        {loading && <p className="text-xs text-muted">正在加载…</p>}

        {settings && !loading && (
          <fieldset disabled={saving} className="m-0 min-w-0 space-y-4 border-0 p-0">
            {/* Poll interval */}
            <div>
              <label className="mb-2 block text-xs text-muted">轮询间隔</label>
              <div className="flex gap-2">
                {POLL_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => update({ pollIntervalMs: preset.value })}
                    className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                      settings.pollIntervalMs === preset.value
                        ? "bg-accent text-white"
                        : "border border-border bg-surface-elevated text-muted hover:bg-surface-hover"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Default LLM port */}
            <div>
              <label className="mb-1 block text-xs text-muted">默认 LLM 端口</label>
              <input
                type="number"
                min={1}
                max={65535}
                value={settings.defaultLlmPort}
                aria-invalid={!portValid}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (!isNaN(val)) update({ defaultLlmPort: val });
                }}
                className="w-full rounded border border-border bg-surface-elevated px-3 py-1.5 text-xs text-text outline-none focus:border-accent"
              />
              <p className="mt-1 text-[10px] text-muted">
                添加新节点时使用的默认端口（1–65535）
              </p>
              {!portValid&&<p role="alert" className="mt-1 text-xs text-danger">端口必须是 1–65535 之间的整数。</p>}
            </div>

            {/* Auto-hide offline */}
            <div>
              <label className="flex items-center gap-3 text-xs text-muted">
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.autoHideOffline}
                  onClick={() => update({ autoHideOffline: !settings.autoHideOffline })}
                  className={`toggle-track relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                    settings.autoHideOffline ? "is-on" : ""
                  }`}
                >
                  <span
                    className={`toggle-dot inline-block h-4 w-4 transform rounded-full shadow transition-transform ${
                      settings.autoHideOffline ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
                在概览中自动隐藏离线节点
              </label>
            </div>

            {/* Hide worker nodes */}
            <div>
              <label className="flex items-start gap-3 text-xs text-muted">
                <button
                  type="button"
                  role="switch"
                  aria-checked={Boolean(settings.hideWorkers)}
                  onClick={() => update({ hideWorkers: !settings.hideWorkers })}
                  className={`toggle-track relative mt-0.5 inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                    settings.hideWorkers ? "is-on" : ""
                  }`}
                >
                  <span
                    className={`toggle-dot inline-block h-4 w-4 transform rounded-full shadow transition-transform ${
                      settings.hideWorkers ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
                <span>
                  <span className="block text-text">隐藏工作节点</span>
                  <span className="mt-0.5 block text-[10px] leading-snug text-muted">
                    在概览和标签栏中隐藏工作节点；直接链接及批量电源、Hermes 操作仍包含这些节点。
                  </span>
                </span>
              </label>
            </div>

            {/* Overview search + status */}
            <div>
              <label className="flex items-start gap-3 text-xs text-muted">
                <button
                  type="button"
                  role="switch"
                  aria-checked={Boolean(settings.showOverviewSearch)}
                  onClick={() =>
                    update({ showOverviewSearch: !settings.showOverviewSearch })
                  }
                  className={`toggle-track relative mt-0.5 inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                    settings.showOverviewSearch ? "is-on" : ""
                  }`}
                >
                  <span
                    className={`toggle-dot inline-block h-4 w-4 transform rounded-full shadow transition-transform ${
                      settings.showOverviewSearch ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
                <span>
                  <span className="block text-text">显示搜索和状态筛选</span>
                  <span className="mt-0.5 block text-[10px] leading-snug text-muted">
                    显示概览节点搜索框与状态筛选（全部、在线、离线、异常），两者共用此开关，默认关闭。
                  </span>
                </span>
              </label>
            </div>

            {/* Fleet Energy */}
            <div>
              <label className="flex items-start gap-3 text-xs text-muted">
                <button
                  type="button"
                  role="switch"
                  aria-checked={Boolean(settings.showFleetEnergy)}
                  onClick={() => update({ showFleetEnergy: !settings.showFleetEnergy })}
                  className={`toggle-track relative mt-0.5 inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                    settings.showFleetEnergy ? "is-on" : ""
                  }`}
                >
                  <span
                    className={`toggle-dot inline-block h-4 w-4 transform rounded-full shadow transition-transform ${
                      settings.showFleetEnergy ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
                <span>
                  <span className="block text-text">显示集群能耗</span>
                  <span className="mt-0.5 block text-[10px] leading-snug text-muted">
                    在概览中显示集群功耗滚动估算卡片，默认关闭。
                  </span>
                </span>
              </label>
            </div>

            {/* Fleet exceptions */}
            <div>
              <label className="flex items-start gap-3 text-xs text-muted">
                <button
                  type="button"
                  role="switch"
                  aria-checked={Boolean(settings.showFleetExceptions)}
                  onClick={() =>
                    update({ showFleetExceptions: !settings.showFleetExceptions })
                  }
                  className={`toggle-track relative mt-0.5 inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                    settings.showFleetExceptions ? "is-on" : ""
                  }`}
                >
                  <span
                    className={`toggle-dot inline-block h-4 w-4 transform rounded-full shadow transition-transform ${
                      settings.showFleetExceptions ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
                <span>
                  <span className="block text-text">显示集群当前异常</span>
                  <span className="mt-0.5 block text-[10px] leading-snug text-muted">
                    在概览中显示离线、GPU 降频、磁盘、模型和 Tailnet 异常，默认关闭。
                  </span>
                </span>
              </label>
            </div>

            {/* Benchmark debug traces */}
            <div>
              <label className="flex items-start gap-3 text-xs text-muted">
                <button
                  type="button"
                  role="switch"
                  aria-checked={Boolean(settings.benchDebugTraces)}
                  onClick={() =>
                    update({ benchDebugTraces: !settings.benchDebugTraces })
                  }
                  className={`toggle-track relative mt-0.5 inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                    settings.benchDebugTraces ? "is-on" : ""
                  }`}
                >
                  <span
                    className={`toggle-dot inline-block h-4 w-4 transform rounded-full shadow transition-transform ${
                      settings.benchDebugTraces ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
                <span>
                  <span className="block text-text">为基准测试启用调试跟踪</span>
                  <span className="mt-0.5 block text-[10px] leading-snug text-muted">
                    将提示词、HTTP/生成请求 ID、内容预览及 GPU 采样存入测试历史。默认关闭；启用后文件更大，且可能包含敏感内容。
                  </span>
                </span>
              </label>
            </div>

            {/* Temperature unit */}
            <div>
              <label className="text-xs text-muted">温度单位</label>
              <div className="mt-1.5 flex gap-2">
                <button
                  type="button"
                  onClick={() => update({ temperatureUnit: "celsius" })}
                  className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                    settings.temperatureUnit === "celsius"
                      ? "bg-accent text-white"
                      : "border border-border bg-surface-elevated text-muted hover:bg-surface-hover"
                  }`}
                >
                  °C
                </button>
                <button
                  type="button"
                  onClick={() => update({ temperatureUnit: "fahrenheit" })}
                  className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                    settings.temperatureUnit === "fahrenheit"
                      ? "bg-accent text-white"
                      : "border border-border bg-surface-elevated text-muted hover:bg-surface-hover"
                  }`}
                >
                  °F
                </button>
              </div>
            </div>

            {/* Density */}
            <div>
              <label className="flex items-start gap-3 text-xs text-muted">
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.density === "compact"}
                  onClick={() =>
                    update({
                      density: settings.density === "compact" ? "comfortable" : "compact",
                    })
                  }
                  className={`toggle-track relative mt-0.5 inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                    settings.density === "compact" ? "is-on" : ""
                  }`}
                >
                  <span
                    className={`toggle-dot inline-block h-4 w-4 transform rounded-full shadow transition-transform ${
                      settings.density === "compact" ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
                <span>
                  <span className="block text-text">紧凑界面</span>
                  <span className="mt-0.5 block text-[10px] leading-snug text-muted">
                    减小间距、圆角和字号，以在一屏内显示更多节点。
                  </span>
                </span>
              </label>
            </div>
          </fieldset>
        )}

        {/* Links */}
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border pt-3">
          <span className="text-[10px] text-muted">sparkDash v{packageJson.version}</span>
          <span className="text-border-strong text-[10px]">·</span>
          <a
            href="https://x.com/MiaAI_lab"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-muted hover:text-accent transition-colors"
          >
            𝕏 @MiaAI_lab
          </a>
          <span className="text-border-strong text-[10px]">·</span>
          <a
            href="https://github.com/MiaAI-Lab"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-muted hover:text-accent transition-colors"
          >
            GitHub MiaAI-Lab
          </a>
        </div>
        </div>

        {error && (
          <div className="shrink-0 px-6 pt-1 text-xs">
            <div role="alert" className="rounded bg-danger/20 px-3 py-2 text-danger">{error}</div>
            {!settings&&<button type="button" className="mt-2 underline" disabled={loading} onClick={()=>setRetry(n=>n+1)}>重新加载设置</button>}
          </div>
        )}

        <div className="flex shrink-0 justify-end gap-2 border-t border-border bg-inherit px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="min-h-11 rounded border border-border bg-surface-elevated px-3 py-1.5 text-xs text-muted hover:bg-surface-hover"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !settings || !dirty || !portValid}
            className="min-h-11 rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? "正在保存…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
