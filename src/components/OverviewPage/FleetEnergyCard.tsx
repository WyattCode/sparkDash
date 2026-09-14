import { useEffect, useState } from "react";
import { fetchFleetEnergy } from "../../api/client";
import type { FleetEnergy } from "../../api/types";

const DAY_MS = 86_400_000;

function number(value: number | null, digits = 2): string {
  return value == null ? "—" : value.toFixed(digits);
}

export function FleetEnergyCard({ nodeCount }: { nodeCount: number }) {
  const [data, setData] = useState<FleetEnergy | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => fetchFleetEnergy()
      .then((next) => { if (!cancelled) { setData(next); setError(null); } })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); });
    void load();
    const timer = window.setInterval(load, 10_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  const coverage = data && nodeCount > 0
    ? Math.min(100, (data.coverage24hMs / DAY_MS) * 100)
    : 0;
  const state = error
    ? `能耗遥测不可用： ${error}`
    : data?.membershipChanged
      ? "集群成员已变更，请重启 sparkDash 以重新建立统计范围。"
      : !data
        ? "正在加载集群能耗…"
        : data.freshNodeCount < nodeCount
          ? `部分覆盖： ${data.freshNodeCount}/${nodeCount} 个节点数据有效。`
          : data.energy24hKwh == null
            ? "正在积累样本，尚无完整能耗区间。"
            : null;

  return (
    <section className="panel p-4" aria-labelledby="fleet-energy-title">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="fleet-energy-title" className="text-sm font-semibold text-text-strong">集群能耗（估算）</h2>
          <p className="text-[10px] text-muted">估算值，非电表实测 · 24 小时完整集群覆盖率 {coverage.toFixed(1)}%</p>
        </div>
        <span className="text-xs text-muted">{data ? `${data.freshNodeCount}/${nodeCount} 有效` : "—"}</span>
      </div>
      {state && <p className="mt-3 rounded bg-warning/10 px-3 py-2 text-xs text-warning" role="status">{state}</p>}
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div><div className="text-[10px] text-muted">当前估算功耗</div><strong className="font-tabular text-sm">{number(data?.currentWatts30s ?? null, 0)} W</strong></div>
        <div><div className="text-[10px] text-muted">24 小时已观测能耗</div><strong className="font-tabular text-sm">{number(data?.energy24hKwh ?? null)} kWh</strong></div>
        <div><div className="text-[10px] text-muted">31 天已观测能耗</div><strong className="font-tabular text-sm">{number(data?.energy31dKwh ?? null)} kWh</strong></div>
        <div><div className="text-[10px] text-muted">输出 Token 能耗</div><strong className="font-tabular text-sm">{number(data?.whPerOutputToken24h ?? null, 4)} Wh/token</strong></div>
      </div>
      <p className="ops-note">每百万输出 Token：{number(data?.whPerOutputToken24h == null ? null : data.whPerOutputToken24h * 1000)} kWh（估算，仅完整覆盖区间）</p>
      <div className="mt-3 flex h-12 items-end gap-px" aria-label="过去 24 小时每小时估算功率，缺失区间留空">
        {(data?.hourlyWatts24h ?? Array(24).fill(null)).map((watts, index, values) => {
          const max = Math.max(1, ...values.filter((value): value is number => value != null));
          return <span key={index} className="min-w-0 flex-1 bg-accent/60" style={{ height: watts == null ? 0 : `${Math.max(4, (watts / max) * 100)}%` }} title={watts == null ? "无完整覆盖" : `${watts.toFixed(0)} W`} />;
        })}
      </div>
    </section>
  );
}
