import { useEffect, useState } from 'react';
import { apiFetch } from '../../api/client';
import { displayName } from '../../displayName';

export interface TokenTotals {
  range: string; timeZone: string; startedAt: number; persistenceError: string | null;
  rows: Array<{sparkId:string;port:number;modelId:string;lastSeenAt:number;
    completionTokens:number;promptTokens:number|null;cachedTokens:number|null}>;
}
const number=(value:number|null)=>value==null?'—':value.toLocaleString('zh-CN');

export function TokenLedgerCard() {
  const [range,setRange]=useState('today');
  const [data,setData]=useState<TokenTotals|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [open,setOpen]=useState(false);
  useEffect(()=>{
    if(!open)return;
    let cancelled=false,timer:ReturnType<typeof setTimeout>|undefined;
    const controller=new AbortController();setData(null);setError(null);
    const load=async()=>{
      try {const next=await apiFetch<TokenTotals>(`/api/llm-token-totals?range=${range}`,{signal:controller.signal});
        if(!cancelled){setData(next);setError(null);}
      }catch(e){if(!cancelled)setError(e instanceof Error?e.message:'Token 台账读取失败');}
      finally{if(!cancelled)timer=setTimeout(load,15000);}
    };
    void load();
    return()=>{cancelled=true;controller.abort();if(timer)clearTimeout(timer);};
  },[range,open]);
  return <details className="panel p-4" onToggle={e=>setOpen(e.currentTarget.open)}>
    <summary className="cursor-pointer text-sm font-semibold text-text-strong">模型 Token 台账</summary>
    {open && <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted">仅累计启用后观测到的增量 · 按 UTC 自然日统计 · 每 15 秒更新</p>
        <select aria-label="Token 统计范围" value={range} onChange={e=>setRange(e.target.value)} className="rounded border border-border bg-surface-elevated px-2 py-1 text-xs text-text">
          <option value="today">今日（UTC）</option><option value="7d">近 7 日（UTC）</option><option value="30d">近 30 日（UTC）</option><option value="all">累计观测</option>
        </select>
      </div>
      {error && <p role="alert" className="text-xs text-warning">{error}；已有数值可能过期。</p>}
      {data?.persistenceError && <p role="alert" className="text-xs text-warning">{data.persistenceError}</p>}
      {!data&&!error && <p role="status" className="text-xs text-muted">正在加载 Token 台账…</p>}
      {data?.rows.length===0 && <p role="status" className="text-xs text-muted">尚无新增 Token 记录。首次采样仅建立基线，后续可用计数增量会自动入账。</p>}
      {data?.rows.map(row=><article key={`${row.sparkId}:${row.port}:${row.modelId}`} className="rounded border border-border p-3">
        <div className="min-w-0 break-words text-xs text-text-strong">{row.modelId}</div>
        <div className="mt-1 text-[10px] text-muted">{displayName(row.sparkId)} · 端口 {row.port}</div>
        <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {([['输入 Token',row.promptTokens],['缓存命中 Token',row.cachedTokens],['输出 Token',row.completionTokens]] as const).map(([label,value])=><div key={label} className="flex min-w-0 items-baseline justify-between gap-2 sm:block"><dt className="shrink-0 text-[10px] text-muted">{label}</dt><dd className="break-all font-tabular text-sm text-text">{number(value)}</dd></div>)}
        </dl>
      </article>)}
      <p className="text-[10px] text-muted">缓存命中是输入的一部分，不重复相加。缺失计数显示 —；离线、模型切换及计数器重置会重新建立基线，不补算未知区间。目前接入 SGLang，工作节点不重复计数。</p>
    </div>}
  </details>;
}
