import {useLayoutEffect,useRef} from 'react';
import {blendCurve,curveEase,curvePath,CURVE_DURATION_MS,type CurvePoint} from './curve';

/** Shared, bounded SVG motion for all instrument traces. No React frame updates. */
export function SmoothTrace({points,color,areaBase,fillOpacity=.12,dashed=false,motionKey=''}:{points:readonly CurvePoint[];color:string;areaBase?:number;fillOpacity?:number;dashed?:boolean;motionKey?:string}){
  const root=useRef<SVGGElement>(null),painted=useRef<{key:string;points:readonly CurvePoint[]}|null>(null);
  const signature=JSON.stringify(points);
  const path=curvePath(points);
  const area=(d:string,p:readonly CurvePoint[])=>d&&p.length?`${d} L${p.at(-1)!.x},${areaBase} L${p[0].x},${areaBase} Z`:'';
  useLayoutEffect(()=>{
    const group=root.current;if(!group)return;
    const target:CurvePoint[]=JSON.parse(signature);
    let id=0,disposed=false;
    const media=typeof window.matchMedia==='function'?window.matchMedia('(prefers-reduced-motion: reduce)'):null;
    const draw=(next:readonly CurvePoint[])=>{
      const d=curvePath(next);group.querySelector('[data-trace-line]')?.setAttribute('d',d);
      group.querySelector('[data-trace-area]')?.setAttribute('d',area(d,next));
      painted.current={key:motionKey,points:next};
      group.closest('.chart-readout')?.dispatchEvent(new Event('chartpaint'));
    };
    const settle=()=>{cancelAnimationFrame(id);if(!disposed)draw(target);};
    const previous=painted.current?.key===motionKey?painted.current.points:null;
    const rect=group.getBoundingClientRect();
    const inView=rect.width>0&&rect.height>=0&&rect.bottom>0&&rect.top<innerHeight;
    if(previous&&previous.length>1&&target.length>1&&!media?.matches&&!document.hidden&&inView){
      const started=performance.now();let last=started;
      draw(previous);
      const frame=(now:number)=>{
        if(disposed)return;if(document.hidden){settle();return;}
        const p=Math.min(1,(now-started)/CURVE_DURATION_MS);
        if(now-last>=1000/30||p===1){draw(blendCurve(previous,target,curveEase(p)));last=now;}
        if(p<1)id=requestAnimationFrame(frame);
      };id=requestAnimationFrame(frame);
    }else draw(target);
    const observer=typeof IntersectionObserver==='undefined'?null:new IntersectionObserver(entries=>{if(entries.some(e=>!e.isIntersecting))settle();});observer?.observe(group);
    media?.addEventListener('change',settle);document.addEventListener('visibilitychange',settle);
    return()=>{disposed=true;cancelAnimationFrame(id);observer?.disconnect();media?.removeEventListener('change',settle);document.removeEventListener('visibilitychange',settle);};
  // The signature prevents identical polling snapshots from restarting the transition.
  },[signature,motionKey,areaBase]);
  return <g ref={root} className="smooth-trace">
    {areaBase!=null&&<path data-trace-area d={area(path,points)} fill={color} opacity={fillOpacity} stroke="none"/>}
    <path data-trace-line d={path} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dashed?'4 3':undefined} vectorEffect="non-scaling-stroke"/>
  </g>;
}
