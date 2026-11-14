import { useEffect, useMemo, useRef, useState } from 'react';
import { useTimedMetricsHistory } from '../../hooks/metricsStore';
import type { TimedSample } from '../../hooks/ringBuffer';
import { interpolateTrend, TREND_GAP_MS, type TrendFrame } from './trendMotion';
import {curveEase,CURVE_DURATION_MS,traceCurve} from '../ui/curve';
import {ChartReadout} from '../ui/ChartReadout';

/** Retain offscreen context so the boundary-crossing segment is clipped, not deleted. */
export function recentTrend(samples: readonly TimedSample[], now: number): TimedSample[] {
  return samples.filter(s => s.at >= now - 60_000 - TREND_GAP_MS && s.at <= now && Number.isFinite(s.value) && s.value >= 0);
}
/** Round instruments to readable ticks, with half a tick of headroom. */
export function trendScale(peak: number): { max: number; ticks: number[] } {
  const value = Number.isFinite(peak) && peak > 0 ? peak : 10;
  const raw = value / 3;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].find(n => n * power >= raw) ?? 10) * power;
  const ceiling = Math.ceil(value / step) * step;
  return { max: ceiling + step / 2, ticks: Array.from({ length: Math.round(ceiling / step) + 1 }, (_, i) => i * step) };
}
export function CockpitTrend({ sparkId, port, stale, compact = false }: { sparkId: string; port: number | string; stale: boolean; compact?: boolean }) {
  const [expanded,setExpanded] = useState(()=>!compact || typeof window.matchMedia !== 'function' || window.matchMedia('(min-width:640px)').matches);
  useEffect(()=>{
    if(!compact || typeof window.matchMedia !== 'function')return;
    const query=window.matchMedia('(min-width:640px)');
    const update=()=>setExpanded(query.matches);query.addEventListener('change',update);return()=>query.removeEventListener('change',update);
  },[compact]);
  const history = useTimedMetricsHistory(sparkId, `llm:${port}.tps`);
  const canvas = useRef<HTMLCanvasElement>(null);
  const painted=useRef<{source:string;frame:TrendFrame}|null>(null);
  const end = Date.now();
  const points = useMemo(() => recentTrend(history, end), [history, end]);
  const valid = !stale && points.length > 1 && end - points[points.length - 1].at < 10_000;
  useEffect(() => {
    const el = canvas.current;
    if (!el || !valid || !expanded) { painted.current=null;return; }
    const source=`${sparkId}:${port}`;
    const {max,ticks}=trendScale(Math.max(0,...points.filter(s=>s.at>=end-60_000).map(s=>s.value)));
    const target:TrendFrame={points,end,max};
    let frameId=0,disposed=false;
    const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
    const draw = (frame:TrendFrame) => {
      const width = el.clientWidth, height = compact ? 112 : 184, ratio = Math.min(window.devicePixelRatio || 1, 2);
      if(width<=0)return;
      const pixelWidth=Math.round(width*ratio),pixelHeight=Math.round(height*ratio);
      if(el.width!==pixelWidth||el.height!==pixelHeight){el.width=pixelWidth;el.height=pixelHeight;}
      const ctx = el.getContext('2d'); if (!ctx) return;
      ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);
      const css = getComputedStyle(el);
      const muted = css.getPropertyValue('--color-muted').trim(), accent = css.getPropertyValue('--color-chart-primary').trim();
      const {max,points,end}=frame;
      const left = 34, right = Math.max(left, width - 8), top = 16, bottom = height - 36;
      const family = css.getPropertyValue('--font-ui').trim() || 'sans-serif';
      ctx.font = `12px ${family}`; ctx.fillStyle = muted;ctx.textAlign='left';ctx.textBaseline='alphabetic';ctx.globalAlpha=1;
      ctx.strokeStyle = css.getPropertyValue('--color-border').trim(); ctx.lineWidth = .5;
      ctx.fillText('tok/s', 0, 12);
      ctx.setLineDash([3,4]);
      for (const tick of ticks) {
        const y = bottom - tick / max * (bottom - top);
        ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
        ctx.fillText(String(tick), 0, y + 4);
      }
      for(let i=0;i<=6;i++) { const x=left+(right-left)*i/6;ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke(); }
      ctx.setLineDash([]);
      ctx.beginPath();ctx.moveTo(left,top);ctx.lineTo(left,bottom);ctx.lineTo(right,bottom);ctx.stroke();
      for(const tick of ticks){const y=bottom-tick/max*(bottom-top);ctx.beginPath();ctx.moveTo(left-5,y);ctx.lineTo(left,y);ctx.stroke();}
      // Fade just the data at the exit edge, never the grid/labels. Keep drawing
      // the offscreen predecessor until the entire crossing segment has left.
      const edge=ctx.createLinearGradient(left,0,Math.min(right,left+1),0);
      edge.addColorStop(0,'transparent');edge.addColorStop(1,accent);
      ctx.strokeStyle = edge; ctx.lineWidth = 1.8;
      ctx.save();ctx.beginPath();ctx.rect(left,top,right-left,bottom-top);ctx.clip();
      let previous: TimedSample | undefined;
      const segments: {x:number;y:number}[][] = [[]];
      for (const sample of points) {
        const x = left + (sample.at - (end - 60_000)) / 60_000 * (right - left), y = bottom - sample.value / max * (bottom - top);
        if (previous && sample.at - previous.at > TREND_GAP_MS) segments.push([]);
        segments[segments.length-1].push({x,y});
        previous = sample;
      }
      for (const segment of segments) {
        if (segment.length<2) continue;
        ctx.beginPath();traceCurve(ctx,segment);
        ctx.lineTo(segment[segment.length-1].x,bottom);
        ctx.lineTo(segment[0].x,bottom);ctx.closePath();
        ctx.fillStyle=edge;ctx.globalAlpha=.09;ctx.fill();ctx.globalAlpha=1;
        ctx.beginPath();traceCurve(ctx,segment);ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle=muted;
      const label = (at: number) => new Date(at).toLocaleTimeString('zh-CN', { hour12: false });
      for(let i=0;i<=6;i++){ctx.textAlign=i===0?'left':i===6?'right':'center';ctx.fillText(label(end-60_000+i*10_000),left+(right-left)*i/6,height-5);}
      painted.current={source,frame};
      el.closest('.chart-readout')?.dispatchEvent(new Event('chartpaint'));
    };
    const settle=()=>{cancelAnimationFrame(frameId);if(!disposed&&!document.hidden)draw(target);};
    const previous=painted.current?.source===source?painted.current.frame:null;
    const rect=el.getBoundingClientRect();
    if(previous&&!motion.matches&&!document.hidden&&rect.bottom>0&&rect.top<window.innerHeight){
      const started=performance.now();let lastPaint=started;
      draw(previous);
      const advance=(now:number)=>{
        if(disposed)return;
        if(document.hidden){cancelAnimationFrame(frameId);return;}
        const progress=Math.min(1,(now-started)/CURVE_DURATION_MS);
        // A bounded 30fps transition; no perpetual heartbeat or per-sample React render.
        if(now-lastPaint>=1000/30||progress===1){draw(interpolateTrend(previous,target,curveEase(progress)));lastPaint=now;}
        if(progress<1)frameId=requestAnimationFrame(advance);
      };
      frameId=requestAnimationFrame(advance);
    }else settle();
    let initialResize=true;
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(()=>{if(initialResize){initialResize=false;return;}settle();}); resize?.observe(el);
    const visible=()=>settle();
    const intersection=typeof IntersectionObserver==='undefined'?null:new IntersectionObserver(entries=>{
      for(const entry of entries)if(!entry.isIntersecting)settle();
    });intersection?.observe(el);
    const theme = new MutationObserver(settle); theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    motion.addEventListener('change',settle);document.addEventListener('visibilitychange',visible);
    return () => { disposed=true;cancelAnimationFrame(frameId);resize?.disconnect();intersection?.disconnect();theme.disconnect();motion.removeEventListener('change',settle);document.removeEventListener('visibilitychange',visible); };
  }, [points, valid, end, compact, expanded, sparkId, port]);
  return <details className={`cockpit-trend${compact?' cockpit-trend--responsive':''}`} open={expanded} onToggle={e=>setExpanded(e.currentTarget.open)}>
    <summary className="cockpit-trend__toggle">近 1 分钟吞吐趋势</summary>
    <div className="cockpit-trend__heading"><span>输出吞吐 · 近 1 分钟</span><small>tok/s · 页面采样</small></div>
    {valid ? <ChartReadout samples={points} label="输出吞吐" unit="tok/s" timeWindow={{end,span:60000,left:34,right:8}} marker={(index,element)=>{
      const frame=painted.current?.frame,sample=points[index];if(!frame||!sample)return null;
      const live=frame.points.find(s=>s.at===sample.at)??(sample.at===points.at(-1)?.at?frame.points.at(-1):null);if(!live)return null;
      const width=element.clientWidth,height=compact?112:184;
      const x=34+(live.at-(frame.end-60000))/60000*(width-42),y=height-36-live.value/frame.max*(height-52);
      return x>=34&&x<=width-8?{x,y,top:16,bottom:36}:null;
    }}><canvas ref={canvas} role="img" aria-label={`近一分钟输出吞吐，最新 ${points[points.length - 1].value.toFixed(1)} tok/s；中断时保留缺口`} /></ChartReadout>
      : <div className="cockpit-trend__empty" role="status">{stale ? '实时数据暂不可用，等待新鲜采样' : '正在积累实时曲线，当前读数见上方'}</div>}
  </details>;
}
