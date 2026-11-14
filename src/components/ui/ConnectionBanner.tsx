type ConnectionBannerProps = {
  connected: boolean;
  lastValidSnapshotAt: number | null;
  snapshotError: string | null;
  now: number;
  stale: boolean;
};

function formatAge(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

export function ConnectionBanner({
  connected,
  lastValidSnapshotAt,
  snapshotError,
  now,
  stale,
}: ConnectionBannerProps) {
  if (connected && !snapshotError && !stale) return null;

  let message = "正在连接实时遥测…";
  if (snapshotError) message = snapshotError;
  else if (lastValidSnapshotAt != null) {
    const age = formatAge(now - lastValidSnapshotAt);
    message = connected
      ? `遥测数据已过期，上次有效更新在 ${age} 前。`
      : `实时遥测已断开，正在显示 ${age} 前的数据。`;
  } else if (!connected) {
    message = "正在连接实时遥测，等待首次有效更新…";
  }

  const announced = snapshotError
    ? "遥测数据错误。"
    : lastValidSnapshotAt == null
      ? "正在连接实时遥测。"
    : connected
      ? "遥测数据已过期。"
      : "实时遥测已断开。";

  return (
    <div className="connection-banner">
      <span className="connection-banner-dot" aria-hidden="true" />
      <span className="sr-only" role="status" aria-live="polite">
        {announced}
      </span>
      <span aria-hidden="true">{message}</span>
    </div>
  );
}
