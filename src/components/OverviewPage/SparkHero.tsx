import { displayName } from '../../displayName';
import type { SparkSnapshot } from '../../api/types';
import { resolveSparkRole } from '../../api/sparkRole';

export function SparkHero({sparks, stale, onSelect}: {sparks: SparkSnapshot[]; stale: boolean; onSelect?: (id: string) => void}) {
  const head=sparks.find(s=>resolveSparkRole(s)==='head');
  const model=head?.metrics.llm?.find(m=>m.available);
  const ready=!stale && !!head?.online && !!model;
  const online=sparks.filter(s=>s.online).length;
  const count=(n: unknown)=>ready && typeof n==='number' && Number.isFinite(n) && n>=0 ? String(Math.round(n)) : '—';
  const value=(n: unknown, unit='')=>ready && typeof n==='number' && Number.isFinite(n) && n>=0 ? `${n.toLocaleString('zh-CN',{maximumFractionDigits:1})}${unit}` : '—';
  const context=model?.contextLength;
  const validContext=ready && typeof context==='number' && Number.isSafeInteger(context) && context>0;
  const contextLabel=validContext ? context>=1048576 ? `${(context/1048576).toLocaleString('zh-CN',{maximumFractionDigits:1})}M` : context>=1024 ? `${(context/1024).toLocaleString('zh-CN',{maximumFractionDigits:1})}K` : String(context) : '—';
  return <section className="dgx-hero" aria-label="DGX Spark 集群概览">
    <div className="dgx-hero__identity">
      <div className="dgx-hero__eyebrow"><span />NVIDIA · PERSONAL AI SUPERCOMPUTER</div>
      <h2>DGX <span>Spark</span></h2>
      <p className="dgx-hero__description">桌面级 AI 超级计算 · 多节点协同推理</p>
      <div className="dgx-hero__model">
        <div><small>主节点模型服务</small><strong>{model?.modelId || '暂无可用模型'}</strong><span>{displayName(head?.name || '未配置主节点')} · {stale ? '数据已过期' : ready ? '服务可用' : '服务不可用'}</span></div>
        {head && <a href={`/spark/${encodeURIComponent(head.id)}`} onClick={e=>{if(onSelect&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.altKey){e.preventDefault();onSelect(head.id);}}}>服务详情 ↗</a>}
      </div>
      <div className="dgx-hero__silhouette" aria-hidden="true"><i/><i/><i/><i/></div>
    </div>
    <div className="dgx-hero__metrics">
      <div><span>集群在线</span><strong>{stale?'—':`${online} / ${sparks.length}`}</strong><small>{stale?'等待新鲜数据':'已配置节点 · 实时状态'}</small></div>
      <div><span>输出吞吐</span><strong>{value(model?.generationTps)}<em> tok/s</em></strong><small>主节点模型服务</small></div>
      <div><span>处理中 / 排队中</span><strong>{count(model?.requestsRunning)} / {count(model?.requestsWaiting)}</strong><small>请求数量 · 非用户人数</small></div>
      <div><span>上下文容量</span><strong title={validContext ? `${context.toLocaleString('zh-CN')} tokens` : '未获取有效上下文容量'}>{contextLabel}</strong><small>每请求 token 上限</small></div>
    </div>
  </section>;
}
