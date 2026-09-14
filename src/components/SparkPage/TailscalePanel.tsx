import type { TailscaleMetrics } from "../../api/types";
import { Panel } from "../ui/Panel";
import { NetworkIcon } from "../ui/icons";

interface TailscalePanelProps {
  tailscale: TailscaleMetrics | null;
}

/**
 * Tailnet presence for one unit. The failure mode is "healthy on the LAN,
 * invisible off it" — every other panel is LAN-fed and looks fine.
 */
export function TailscalePanel({ tailscale }: TailscalePanelProps) {
  const online = tailscale?.online ?? null;
  const health = tailscale?.health ?? [];
  const available = Boolean(tailscale?.available);
  const offTailnet = available && online === false;

  const status = !available
    ? { label: "未知", cls: "text-muted" }
    : online === true
      ? { label: "在线", cls: "text-accent" }
      : online === false
        ? { label: "Tailnet 离线", cls: "text-danger" }
        : { label: "未知", cls: "text-muted" };

  return (
    <Panel title="Tailnet" accent={offTailnet} icon={<NetworkIcon />}>
      <div className="mb-3 flex items-center gap-2 text-xs">
        <span className="text-muted">状态</span>
        <span className={`font-tabular font-medium ${status.cls}`}>{status.label}</span>
        {tailscale?.backendState && (
          <span className="ml-auto chip py-0.5">{tailscale.backendState}</span>
        )}
      </div>

      {health.length > 0 && (
        <div className="mb-2 space-y-1">
          {health.map((msg) => (
            <p
              key={msg}
              className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[11px] text-text"
            >
              {msg}
            </p>
          ))}
        </div>
      )}

      {tailscale?.error && (
        <p className="mb-2 rounded-md border border-border bg-surface-elevated px-3 py-2 text-[11px] text-muted">
          {tailscale.error}
        </p>
      )}

      <div className="space-y-2">
        {tailscale?.tailscaleIp && <Row label="IP" value={tailscale.tailscaleIp} tabular />}
        {tailscale?.hostName && <Row label="主机" value={tailscale.hostName} />}
        {tailscale?.relay && <Row label="中继" value={tailscale.relay} />}
        {tailscale?.keyExpired && <Row label="密钥" value="EXPIRED — needs re-auth" danger />}
        {tailscale?.version && <Row label="版本" value={tailscale.version} tabular />}
        {!available && !tailscale?.error && (
          <p className="text-xs text-muted">等待首次采集…</p>
        )}
      </div>
    </Panel>
  );
}

function Row({
  label,
  value,
  tabular,
  danger,
}: {
  label: string;
  value: string;
  tabular?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border bg-surface-elevated px-3 py-2">
      <span className="text-xs text-muted">{label}</span>
      <span
        className={`truncate text-xs ${tabular ? "font-tabular" : ""} ${
          danger ? "text-danger" : "text-text"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
