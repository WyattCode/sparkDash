import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUp, ArrowDown, SlidersHorizontal } from 'lucide-react';
import type { SparkSnapshot } from '../api/types';
import { displayName } from '../displayName';

/** Device selection is local context, not a second global tab bar. */
export function NodeNavigation({sparks,activeId,onSelect,onAdd,onEdit,onReorder}: {
  sparks:SparkSnapshot[]; activeId:string|null; onSelect:(id:string|null)=>void;
  onAdd:()=>void; onEdit:(id:string)=>void; onReorder:(ids:string[])=>void|Promise<void>;
}) {
  const id=useId(),[saving,setSaving]=useState(false);
  const root=useRef<HTMLElement>(null);
  useEffect(()=>{
    const close=(event:PointerEvent)=>{
      if(event.target instanceof Node && !root.current?.contains(event.target))
        root.current?.querySelectorAll('details[open]').forEach(el=>el.removeAttribute('open'));
    };
    document.addEventListener('pointerdown',close);
    return()=>document.removeEventListener('pointerdown',close);
  },[]);
  const selected=sparks.some(s=>s.id===activeId)?activeId! : '';
  const closeOnEscape=(event:KeyboardEvent<HTMLDetailsElement>)=>{
    if(event.key!=='Escape'||!event.currentTarget.open)return;
    event.preventDefault();event.stopPropagation();
    event.currentTarget.open=false;
    event.currentTarget.querySelector<HTMLElement>(':scope > summary')?.focus();
  };
  async function move(index:number,offset:number){
    const next=index+offset;if(saving||next<0||next>=sparks.length)return;
    const ids=sparks.map(s=>s.id);[ids[index],ids[next]]=[ids[next],ids[index]];
    setSaving(true);try{await onReorder(ids);}finally{setSaving(false);}
  }
  return <section ref={root} className="node-navigation" aria-label="节点选择与管理">
    <label htmlFor={id}>查看节点</label>
    <select id={id} value={selected} onChange={e=>onSelect(e.target.value||null)}>
      <option value="">全部节点</option>{sparks.map(s=><option value={s.id} key={s.id}>{displayName(s.name)} · {s.online?'在线':'离线'}</option>)}
    </select>
    <details className="node-manage" onKeyDown={closeOnEscape}><summary aria-label="节点管理" title="节点管理"><SlidersHorizontal aria-hidden="true"/></summary><div className="node-navigation__actions"><button onClick={e=>{e.currentTarget.closest('details.node-manage')?.removeAttribute('open');onAdd();}}>添加节点</button>{selected&&<button onClick={e=>{e.currentTarget.closest('details.node-manage')?.removeAttribute('open');onEdit(selected);}}>编辑节点</button>}
      {sparks.length>1&&<details className="node-order" onKeyDown={closeOnEscape}><summary>调整顺序</summary><div className="node-order__popover"><p>调整显示顺序，操作后自动保存。</p><ol>{sparks.map((s,index)=><li key={s.id}><span>{displayName(s.name)}</span><button disabled={saving||index===0} aria-label={`上移 ${displayName(s.name)}`} onClick={()=>void move(index,-1)}><ArrowUp aria-hidden="true"/></button><button disabled={saving||index===sparks.length-1} aria-label={`下移 ${displayName(s.name)}`} onClick={()=>void move(index,1)}><ArrowDown aria-hidden="true"/></button></li>)}</ol></div></details>}
    </div></details>
  </section>;
}
