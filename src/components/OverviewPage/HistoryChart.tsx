import {useId,useLayoutEffect,useRef,useState} from 'react';
import {SmoothTrace} from '../ui/SmoothTrace';
import type {CurvePoint} from '../ui/curve';
import type {Series} from './operationsModel';
export function historyTick(value:number,max:number){return value.toLocaleString('zh-CN',{maximumFractionDigits:max<3?2:0});}

export function HistoryChart({series,minutes,motionKey}:{series:Series[];minutes:number;motionKey:string}){
 const clip=useId();
 const root=useRef<SVGSVGElement>(null),[width,setWidth]=useState(1000);
 useLayoutEffect(()=>{const el=root.current;if(!el)return;const measure=()=>setWidth(Math.max(200,el.clientWidth));measure();const observer=new ResizeObserver(measure);observer.observe(el);return()=>observer.disconnect();},[]);
 const points=series.flatMap(s=>s.points),end=Math.max(Date.now(),...points.filter(p=>Number.isFinite(p[0])).map(p=>p[0])),start=end-minutes*60000;
 const max=points.reduce((peak,[at,value])=>Number.isFinite(at)&&at>=start&&at<=end&&value!=null&&Number.isFinite(value)?Math.max(peak,value):peak,1);
 return <svg ref={root} viewBox={`0 0 ${width} 180`} className="ops-chart" role="img" aria-label="所选指标的历史曲线，当前值见下方图例">
  <defs><clipPath id={clip}><rect x={48} y={12} width={Math.max(0,width-58)} height={135}/></clipPath></defs>
  {[0,1,2,3].map(i=><g key={i}><line x1={48} x2={width-10} y1={12+i*45} y2={12+i*45} stroke="var(--color-border)"/><text x={2} y={16+i*45} fill="var(--color-muted)" fontSize={11}>{historyTick(max*(1-i/3),max)}</text></g>)}
  <g clipPath={`url(#${clip})`}>
  {series.map((s,i)=>{
   const segments:{start:number;points:CurvePoint[]}[]=[];let previous:number|null=null;
   for(const [at,value] of s.points){
    if(value==null||!Number.isFinite(value)||!Number.isFinite(at)||value<0){previous=null;continue;}
    if(previous==null||at-previous>Math.max(45000,minutes*60000/80))segments.push({start:at,points:[]});
    segments.at(-1)!.points.push({x:48+(at-start)/(end-start)*(width-58),y:147-value/max*135});previous=at;
   }
   const worker=s.labels.role==='worker';
   return segments.map(segment=><SmoothTrace key={`${i}:${segment.start}`} motionKey={`${motionKey}:${minutes}:${JSON.stringify(s.labels)}:${segment.start}`} points={segment.points} color={worker?'var(--color-chart-secondary)':'var(--color-chart-primary)'} dashed={worker}/>);
  })}
  </g>
  <text x={48} y={173} fill="var(--color-muted)" fontSize={11}>{new Date(start).toLocaleTimeString('zh-CN')}</text><text x={width-10} textAnchor="end" y={173} fill="var(--color-muted)" fontSize={11}>{new Date(end).toLocaleTimeString('zh-CN')}</text>
 </svg>;
}
