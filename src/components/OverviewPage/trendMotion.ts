import type { TimedSample } from '../../hooks/ringBuffer';

export const TREND_GAP_MS=10_000;
export interface TrendFrame { points:readonly TimedSample[]; end:number; max:number }

/** Rendering only: never publish interpolated samples back to telemetry or ARIA. */
export function interpolateTrend(from:TrendFrame,to:TrendFrame,progress:number):TrendFrame {
  const p=Math.max(0,Math.min(1,Number.isFinite(progress)?progress:1));
  if(p===1||!from.points.length)return to;
  const previous=new Map(from.points.map(sample=>[sample.at,sample]));
  const tail=from.points.at(-1)!;
  const mix=(a:number,b:number)=>a+(b-a)*p;
  return {
    end:mix(from.end,to.end),max:mix(from.max,to.max),
    points:to.points.map(sample=>{
      const old=previous.get(sample.at);
      if(old)return {...sample,value:mix(old.value,sample.value)};
      // Extend a new real sample from the previous tail, never bridge an outage.
      if(sample.at>tail.at&&sample.at-tail.at<=TREND_GAP_MS)
        return {at:mix(tail.at,sample.at),value:mix(tail.value,sample.value)};
      return sample;
    }),
  };
}
