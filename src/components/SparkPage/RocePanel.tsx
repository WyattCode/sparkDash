import {useEffect,useId,useState} from 'react';
import {apiFetch} from '../../api/client';
import {Panel} from '../ui/Panel';
import {NetworkIcon} from '../ui/icons';

interface Device {
  name:string;netdev:string|null;state:string|null;physState:string|null;
  active:boolean;rateGbps:number|null;mtu:number|null;rxBps:number|null;txBps:number|null;
  rxErrors:number|null;txErrors:number|null;rxDropped:number|null;txDropped:number|null;
  deltas:Record<string,number>;qos:{trust:string|null;pfcPriorities:number[]|null}|null;
}
interface Facts {available:boolean;stale:boolean;sampledAt:number|null;devices:Device[]}
const number=(v:number|null|undefined,suffix='')=>v!=null&&Number.isFinite(v)?v.toLocaleString('zh-CN',{maximumFractionDigits:1})+suffix:'—';
const rate=(v:number|null)=>v==null?'—':number(v/1024/1024,' MB/s');
const total=(a:number|null,b:number|null)=>a==null||b==null?null:a+b;

export function RocePanel({sparkId,online}:{sparkId:string;online:boolean}) {
  const [open,setOpen]=useState(false),[facts,setFacts]=useState<Facts|null>(null),[error,setError]=useState<string|null>(null);
  const contentId=useId();
  useEffect(()=>{
    setFacts(null);setError(null);
    if(!open||!online)return;
    const controller=new AbortController();let pending=false;
    async function load(){
      if(pending)return;pending=true;
      try {
        const result=await apiFetch<Facts>(`/api/sparks/${encodeURIComponent(sparkId)}/roce`,{signal:controller.signal});
        if(!controller.signal.aborted){setFacts(result);setError(null);}
      }catch {if(!controller.signal.aborted){setFacts(null);setError('采集暂不可用，请稍后重试。');}}
      finally{pending=false;}
    }
    void load();const timer=setInterval(()=>void load(),10000);
    return()=>{controller.abort();clearInterval(timer);};
  },[sparkId,online,open]);
  return <Panel title="高速互联 · RoCE" icon={<NetworkIcon/>} className="md:col-span-2"
    actions={<button type="button" className="text-xs text-muted hover:text-accent" aria-expanded={open} aria-controls={contentId} onClick={()=>setOpen(v=>!v)}>{open?'收起':'查看'}</button>}>
    {open&&<div id={contentId}>
      {!online?<p className="text-xs text-muted">节点离线，未读取互联数据。</p>:error?<p role="status" className="text-xs text-muted">{error}</p>:!facts?<p className="text-xs text-muted">正在读取链路与网口计数…</p>:!facts.available?<p className="text-xs text-muted">未检测到 RDMA 设备，或当前权限无法读取。</p>:<>
        <p className="mb-3 text-xs text-muted">{facts.stale?'数据已过期 · ':''}{facts.devices.filter(d=>d.active&&d.physState==='LinkUp').length} / {facts.devices.length} 链路就绪 · {facts.sampledAt?new Date(facts.sampledAt).toLocaleTimeString('zh-CN'):'—'}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{facts.devices.map(d=><div key={d.name} className="min-w-0 rounded-lg border border-border p-3">
          <p className="break-all text-xs font-semibold text-text">{d.netdev||d.name}</p>
          <p className="mt-1 break-all text-[10px] text-muted">{d.name} · {d.active?'活动':d.state||'未知'} / {d.physState==='LinkUp'?'已连接':d.physState||'未知'}</p>
          <dl className="mt-3 grid grid-cols-2 gap-x-2 gap-y-2 text-xs">
            {([['链路速率',number(d.rateGbps,' Gb/s')],['MTU',number(d.mtu)],['网口接收',rate(d.rxBps)],['网口发送',rate(d.txBps)],['网口错误累计',number(total(d.rxErrors,d.txErrors))],['网口丢包累计',number(total(d.rxDropped,d.txDropped))]] as const).map(([k,v])=><div key={k} className="min-w-0"><dt className="text-[10px] text-muted">{k}</dt><dd className="mt-1 break-all font-tabular text-text">{v}</dd></div>)}
          </dl>
        </div>)}</div>
        <p className="mt-3 text-[10px] text-muted">只读 · 每 10 秒更新 · 网口计数不等于模型通信耗时，不替代路由与转发检查。</p>
      </>}
    </div>}
  </Panel>;
}
