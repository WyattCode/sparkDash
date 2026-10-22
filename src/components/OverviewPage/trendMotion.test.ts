import {expect,it} from 'vitest';
import {interpolateTrend,type TrendFrame} from './trendMotion';
import {recentTrend} from './CockpitTrend';
const before:TrendFrame={end:2000,max:20,points:[{at:1000,value:0},{at:2000,value:10}]};
const after:TrendFrame={end:3000,max:40,points:[...before.points,{at:3000,value:30}]};
it('retains a real predecessor as samples cross the left edge, including every animation frame',()=>{
 const samples=Array.from({length:72},(_,i)=>({at:i*1000,value:i%7}));
 const from:TrendFrame={end:70000,max:10,points:recentTrend(samples,70000)};
 const to:TrendFrame={end:71000,max:10,points:recentTrend(samples,71000)};
 for(const p of [0,.25,.5,.75,1]){
  const frame=interpolateTrend(from,to,p),left=frame.end-60000;
  expect(frame.points.some(s=>s.at<left)).toBe(true);
  expect(frame.points.some(s=>s.at>=left)).toBe(true);
 }
 expect(to.points.some(s=>s.at===10000)).toBe(true);
 expect(to.points[0].at).toBe(1000);
});
it('smoothly advances the viewport, scale and newly arrived tail without changing source samples',()=>{
 const frame=interpolateTrend(before,after,.5);
 expect(frame.end).toBe(2500);expect(frame.max).toBe(30);
 expect(frame.points.at(-1)).toEqual({at:2500,value:20});
 expect(frame.points[0]).toEqual({at:1000,value:0});
 expect(after.points.at(-1)).toEqual({at:3000,value:30});expect(before.points).toHaveLength(2);
});
it('does not bridge missing intervals or fabricate a heartbeat while idle',()=>{
 const gap:TrendFrame={end:15000,max:40,points:[...before.points,{at:15000,value:30}]};
 expect(interpolateTrend(before,gap,.5).points.at(-1)).toEqual({at:15000,value:30});
 const idle={...after,points:after.points.map(s=>({...s,value:0}))};
 expect(interpolateTrend({...before,points:before.points.map(s=>({...s,value:0}))},idle,.5).points.every(s=>s.value===0)).toBe(true);
});
it('clamps progress and settles exactly at the genuine target',()=>{
 expect(interpolateTrend(before,after,2)).toBe(after);
 expect(interpolateTrend(before,after,NaN)).toBe(after);
 expect(interpolateTrend(before,after,-1).points.at(-1)).toEqual({at:2000,value:10});
 expect(interpolateTrend({...before,points:[]},after,.5)).toBe(after);
});
