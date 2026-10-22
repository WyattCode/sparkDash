import {useState,useRef,useEffect,useLayoutEffect,useId,type ReactNode} from 'react';
import {createPortal} from 'react-dom';

export interface ReadoutSample {value:number;at?:number}
export interface ChartMarkerPoint {x:number;y:number;top?:number;bottom?:number}
export function placeReadout(x:number,y:number,width:number,height:number,viewportWidth:number,viewportHeight:number){
 const left=Math.max(8,Math.min(viewportWidth-width-8,x-width/2));
 const above=y-height-12;
 return {left,top:Math.max(8,Math.min(viewportHeight-height-8,above>=8?above:y+12))};
}
/** Read actual samples, never values invented by the visual interpolation. */
export function pickReadout(samples:readonly ReadoutSample[],ratio:number,width:number,window?:{end:number;span:number;left:number;right:number}) {
 if(!samples.length||!Number.isFinite(ratio)||!Number.isFinite(width)||width<=0)return null;
 if(!window)return Math.round(Math.max(0,Math.min(1,ratio))*(samples.length-1));
 const x=ratio*width,right=width-window.right;
 if(x<window.left||x>right||right<=window.left)return null;
 const time=window.end-window.span+(x-window.left)/(right-window.left)*window.span;
 let index=-1,distance=Infinity;
 samples.forEach((s,i)=>{if(s.at==null||!Number.isFinite(s.at)||!Number.isFinite(s.value)||s.at<window.end-window.span||s.at>window.end)return;const d=Math.abs(s.at-time);if(d<distance){index=i;distance=d;}});
 return index>=0&&distance<=5000?index:null;
}
export function ChartReadout({children,samples,label='采样值',unit='',timeWindow,inline=false,marker}:{children:ReactNode;samples:readonly ReadoutSample[];label?:string;unit?:string;timeWindow?:{end:number;span:number;left:number;right:number};inline?:boolean;marker?:(index:number,element:HTMLElement)=>ChartMarkerPoint|null}){
 const [hover,setHover]=useState<{index:number;x:number;y:number}|null>(null);
 const tooltipId=useId();
 const root=useRef<HTMLSpanElement>(null),dot=useRef<HTMLSpanElement>(null),guide=useRef<HTMLSpanElement>(null),tooltip=useRef<HTMLSpanElement>(null);
 const update=useRef(()=>{});
 update.current=()=>{
  if(!hover||!root.current)return;
  const point=marker?.(hover.index,root.current),r=root.current.getBoundingClientRect();
  const visible=!marker||(point&&Number.isFinite(point.x)&&Number.isFinite(point.y));
  for(const el of [dot.current,guide.current,tooltip.current])if(el)el.style.visibility=visible?'visible':'hidden';
  if(!visible)return;
  if(point&&dot.current){dot.current.style.left=`${point.x}px`;dot.current.style.top=`${point.y}px`;}
  if(point&&guide.current){guide.current.style.left=`${point.x}px`;guide.current.style.top=`${point.top??0}px`;guide.current.style.bottom=`${point.bottom??0}px`;}
  if(tooltip.current){const box=tooltip.current.getBoundingClientRect(),position=placeReadout(point?r.left+point.x:hover.x,point?r.top+point.y:hover.y,box.width||180,box.height||64,window.innerWidth,window.innerHeight);tooltip.current.style.left=`${position.left}px`;tooltip.current.style.top=`${position.top}px`;}
 };
 useLayoutEffect(()=>{update.current();});
 useEffect(()=>{
  const el=root.current,paint=()=>update.current(),dismiss=()=>setHover(null),hidden=()=>{if(document.hidden)dismiss();};el?.addEventListener('chartpaint',paint);window.addEventListener('resize',paint);document.addEventListener('scroll',dismiss,true);document.addEventListener('visibilitychange',hidden);
  return()=>{el?.removeEventListener('chartpaint',paint);window.removeEventListener('resize',paint);document.removeEventListener('scroll',dismiss,true);document.removeEventListener('visibilitychange',hidden);};
 },[]);
 const sample=hover&&samples[hover.index];
 return <span ref={root} className={`chart-readout${inline?' chart-readout--inline':''}`} tabIndex={samples.length?0:undefined} role="group" aria-describedby={sample&&Number.isFinite(sample.value)?tooltipId:undefined} aria-label={`${label}趋势，悬停或使用左右方向键查看采样`} onPointerMove={e=>{
  const r=e.currentTarget.getBoundingClientRect(),index=pickReadout(samples,(e.clientX-r.left)/r.width,r.width,timeWindow);
  setHover(index==null?null:{index,x:e.clientX,y:e.clientY});
 }} onPointerLeave={()=>setHover(null)} onFocus={e=>{const r=e.currentTarget.getBoundingClientRect();setHover({index:samples.length-1,x:r.left+r.width/2,y:r.top});}} onBlur={()=>setHover(null)} onKeyDown={e=>{
  if(e.key==='Escape'){setHover(null);return;}
  if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;e.preventDefault();
  const r=e.currentTarget.getBoundingClientRect();setHover(h=>({index:Math.max(0,Math.min(samples.length-1,(h?.index??samples.length-1)+(e.key==='ArrowLeft'?-1:1))),x:r.left+r.width/2,y:r.top}));
 }}>
  {children}
  {sample&&marker&&<><span ref={guide} className="chart-readout__guide" aria-hidden="true"/><span ref={dot} className="chart-readout__dot" aria-hidden="true"/></>}
  {sample&&hover&&Number.isFinite(sample.value)&&createPortal(<span ref={tooltip} id={tooltipId} className="chart-readout__tooltip" role="tooltip" style={{left:Math.max(8,Math.min(window.innerWidth-188,hover.x+12)),top:Math.max(8,Math.min(window.innerHeight-78,hover.y-68))}}>
   <span>{label}{sample.at!=null?` · ${new Date(sample.at).toLocaleTimeString('zh-CN',{hour12:false})}`:` · 采样 ${hover.index+1}`}</span><strong>{sample.value.toLocaleString('zh-CN',{maximumFractionDigits:2})}{unit&&` ${unit}`}</strong>
  </span>,document.body)}
 </span>;
}
