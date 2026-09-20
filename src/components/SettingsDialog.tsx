import { useEffect, useId, useState } from "react";
import { fetchSettings, updateSettings } from "../api/client";
import type { Settings } from "../api/types";
import { useModalPresence } from "../hooks/useModalPresence";
import { useFocusTrap } from '../hooks/useFocusTrap';
import packageJson from "../../package.json";
import { usePwaInstall } from '../hooks/usePwaInstall';

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
  { label: "1 秒", value: 1000 },
  { label: "2 秒", value: 2000 },
  { label: "5 秒", value: 5000 },
  { label: "10 秒", value: 10000 },
];


function SettingsSwitch({ title, detail, checked, onChange }: {
  title: string; detail: string; checked: boolean; onChange: () => void;
}) {
  const id = useId();
  return (
    <button type="button" role="switch" aria-checked={checked}
      aria-labelledby={id} aria-describedby={id + '-detail'}
      className="settings-switch-row" onClick={onChange}>
      <span className="settings-switch-copy">
        <span id={id} className="settings-option-title">{title}</span>
        <span id={id + '-detail'} className="settings-option-detail">{detail}</span>
      </span>
      <span aria-hidden="true" className={`settings-switch-track toggle-track ${checked ? 'is-on' : ''}`}>
        <span className="settings-switch-dot toggle-dot" />
      </span>
    </button>
  );
}

export function SettingsDialog({ open, onClose, onSaved }: SettingsDialogProps) {
  const installation = usePwaInstall();
  const [installationExpanded, setInstallationExpanded] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<Settings | null>(null);
  const [retry,setRetry]=useState(0);

  useEscape(open&&!saving,onClose);
  const titleId=useId();
  const portId=useId();

  useEffect(() => {
    if (!open) {
      setInstallationExpanded(false);
      setSettings(null);
      setError(null);
      setBaseline(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchSettings()
      .then((s) => {
        if (!cancelled) { setSettings(s); setBaseline(s); }
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
  const patch: Partial<Settings> = settings && baseline
    ? Object.fromEntries(Object.entries(settings).filter(([key, value]) => value !== baseline[key as keyof Settings]))
    : {};
  const dirty = Object.keys(patch).length > 0;

  const update = (patch: Partial<Settings>) => {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const handleSave = async () => {
    if (!settings||saving||!dirty) return;
    if(!portValid){setError('端口必须是 1–65535 之间的整数');return;}
    setSaving(true);
    setError(null);
    try {
      // Only send edited fields, preserving unrelated changes from other clients.
      const result = await updateSettings(patch);
      setSettings(result);
      setBaseline(result);
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
      <div ref={trapRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="settings-panel settings-panel--preferences w-full">
        <h2 id={titleId} className="shrink-0 px-6 pt-6 text-sm font-semibold text-text-strong">设置</h2>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4">
        {loading && <p className="text-xs text-muted">正在加载…</p>}

        {settings && !loading && (
          <fieldset disabled={saving} className="m-0 min-w-0 space-y-4 border-0 p-0">
            <h3 className="settings-section-title">监控与连接</h3>
            {/* Poll interval */}
            <div>
              <p className="mb-2 text-xs text-muted">轮询间隔</p>
              <div className="settings-segments" role="group" aria-label="轮询间隔">
                {POLL_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    aria-pressed={settings.pollIntervalMs === preset.value}
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
              <label htmlFor={portId} className="mb-1 block text-xs text-muted">默认模型服务端口</label>
              <input
                id={portId}
                aria-describedby={portId + '-hint'}
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
              <p id={portId + '-hint'} className="mt-1 text-xs text-muted">
                添加新节点时使用的默认端口（1–65535）
              </p>
              {!portValid&&<p role="alert" className="mt-1 text-xs text-danger">端口必须是 1–65535 之间的整数。</p>}
            </div>


            <h3 className="settings-section-title">节点与概览</h3>
            <div className="settings-switch-list">
              <SettingsSwitch title="自动隐藏离线节点" detail="仅影响概览中的节点显示，不会移除节点配置。"
                checked={settings.autoHideOffline} onChange={() => update({ autoHideOffline: !settings.autoHideOffline })} />
              <SettingsSwitch title="隐藏工作节点" detail="在概览和标签栏中隐藏；直接链接、批量电源和 Hermes 操作仍包含这些节点。"
                checked={Boolean(settings.hideWorkers)} onChange={() => update({ hideWorkers: !settings.hideWorkers })} />
              <SettingsSwitch title="显示搜索和状态筛选" detail="同时显示节点搜索框与全部、在线、离线、异常筛选。"
                checked={Boolean(settings.showOverviewSearch)} onChange={() => update({ showOverviewSearch: !settings.showOverviewSearch })} />
              <SettingsSwitch title="显示集群能耗" detail="显示基于集群功耗的滚动估算卡片，并非电表计量。"
                checked={Boolean(settings.showFleetEnergy)} onChange={() => update({ showFleetEnergy: !settings.showFleetEnergy })} />
              <SettingsSwitch title="显示集群当前异常" detail="显示离线、GPU 降频、磁盘、模型和 Tailnet 异常。"
                checked={Boolean(settings.showFleetExceptions)} onChange={() => update({ showFleetExceptions: !settings.showFleetExceptions })} />
            </div>
            <h3 className="settings-section-title">界面显示</h3>
            <div>
              <p className="mb-2 text-xs text-muted">温度单位</p>
              <div className="settings-segments" role="group" aria-label="温度单位">
                {(['celsius', 'fahrenheit'] as const).map(unit => (
                  <button key={unit} type="button" aria-pressed={settings.temperatureUnit === unit}
                    onClick={() => update({ temperatureUnit: unit })}
                    className={settings.temperatureUnit === unit ? 'bg-accent text-white' : 'border border-border bg-surface-elevated text-muted'}>
                    {unit === 'celsius' ? '°C' : '°F'}
                  </button>
                ))}
              </div>
            </div>
            <div className="settings-switch-list">
              <SettingsSwitch title="紧凑界面" detail="减小间距、圆角和字号，在一屏内显示更多内容。"
                checked={settings.density === 'compact'} onChange={() => update({ density: settings.density === 'compact' ? 'comfortable' : 'compact' })} />
            </div>
            <h3 className="settings-section-title">基准测试</h3>
            <div className="settings-switch-list">
              <SettingsSwitch title="基准测试分享图片" detail="在复制结果菜单中提供图片分享；关闭后仅保留文本复制。"
                checked={Boolean(settings.benchShareImage)} onChange={() => update({ benchShareImage: !settings.benchShareImage })} />
              <SettingsSwitch title="启用调试跟踪" detail="将提示词、请求 ID、内容预览和 GPU 采样写入测试历史。文件可能包含敏感内容，并占用更多空间。"
                checked={Boolean(settings.benchDebugTraces)} onChange={() => update({ benchDebugTraces: !settings.benchDebugTraces })} />
            </div>
          </fieldset>
        )}

        <details className="settings-install rounded border border-border p-3"
          open={installationExpanded} onToggle={e => setInstallationExpanded(e.currentTarget.open)}>
          <summary tabIndex={0} className="text-sm font-medium text-text-strong">安装到桌面</summary>
          <p className="mt-2 text-xs text-muted" role="status">
            {installation.installed ? '已安装，可从桌面或应用启动器打开 sparkDash。' : installation.message || (installation.ready ? '浏览器已允许安装，可添加到桌面并以独立窗口打开。' : !installation.secure ? '当前为 HTTP 局域网地址。可在 Android 浏览器菜单中尝试“添加到主屏幕”；完整应用安装需要可信 HTTPS，当前可能只能创建快捷方式，菜单选项因浏览器而异。' : '在浏览器菜单中查找“安装应用”或“添加到主屏幕”（选项因浏览器而异）。浏览器允许安装后，此处也会显示安装按钮。')}
          </p>
          {installationExpanded && !installation.installed && installation.ready && <button type="button" className="mt-3 rounded border border-border px-3 py-2 text-sm text-accent" disabled={installation.busy} onClick={() => void installation.install()}>{installation.busy ? '正在打开安装提示…' : '安装 sparkDash'}</button>}
          <p className="mt-2 text-xs text-muted">安装后仍需连接集群所在网络；不提供离线监控，不缓存实时指标。</p>
        </details>

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

        <div className="settings-footer flex shrink-0 justify-end gap-2 border-t border-border bg-inherit px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
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
