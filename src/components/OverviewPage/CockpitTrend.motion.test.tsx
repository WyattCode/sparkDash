import {act} from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {render,cleanupRenders} from '../../testing/render';
import {useTimedMetricsHistory} from '../../hooks/metricsStore';
import {CockpitTrend} from './CockpitTrend';
vi.mock('../../hooks/metricsStore',()=>({useTimedMetricsHistory:vi.fn()}));
let next=0,hidden=false,reduced=false;
const queue=new Map<number,FrameRequestCallback>();
const context=Object.fromEntries(['setTransform','clearRect','beginPath','moveTo','lineTo','bezierCurveTo','stroke','fill','closePath','save','restore','rect','clip','setLineDash','fillText'].map(name=>[name,vi.fn()]));
const gradient={addColorStop:vi.fn()};
context.createLinearGradient=vi.fn(()=>gradient);
const initial=[{at:99000,value:0},{at:100000,value:10}];
beforeEach(()=>{
 gradient.addColorStop.mockClear();context.createLinearGradient.mockClear();
 vi.useFakeTimers();vi.setSystemTime(100000);queue.clear();hidden=false;reduced=false;
 vi.mocked(useTimedMetricsHistory).mockReturnValue(initial);
 vi.spyOn(performance,'now').mockReturnValue(0);
 vi.spyOn(document,'hidden','get').mockImplementation(()=>hidden);
 vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockReturnValue(640);
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({top:100,bottom:212,left:0,right:640,width:640,height:112,x:0,y:100,toJSON:()=>({})});
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(context as never);
 vi.stubGlobal('matchMedia',(query:string)=>({matches:query.includes('min-width')||reduced,addEventListener:vi.fn(),removeEventListener:vi.fn()}));
 vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>{const id=++next;queue.set(id,cb);return id;});
 vi.stubGlobal('cancelAnimationFrame',(id:number)=>queue.delete(id));
});
afterEach(()=>{cleanupRenders();vi.unstubAllGlobals();vi.useRealTimers();});
const update=()=>{vi.setSystemTime(101000);vi.mocked(useTimedMetricsHistory).mockReturnValue([...initial,{at:101000,value:30}]);};
it('animates only subsequent samples and stops after the bounded transition',()=>{
 context.fillText.mockImplementation((text:string)=>{if(text==='tok/s')expect((context as unknown as CanvasRenderingContext2D).textAlign).toBe('left');});
 const ui=render(<CockpitTrend sparkId="a" port={8888} stale={false}/>);expect(queue.size).toBe(0);
 update();act(()=>ui.root.render(<CockpitTrend sparkId="a" port={8888} stale={false}/>));expect(queue.size).toBe(1);
 for(let at=40;at<=600;at+=40)act(()=>{const callbacks=[...queue.values()];queue.clear();callbacks.forEach(cb=>cb(at));});
 expect(queue.size).toBe(0);expect(context.clearRect.mock.calls.length).toBeGreaterThan(3);
 expect(ui.container.querySelector('canvas')?.getAttribute('aria-label')).toContain('30.0 tok/s');
 expect(context.createLinearGradient).toHaveBeenCalledWith(34,0,35,0);
 expect(gradient.addColorStop).toHaveBeenCalledWith(0,'transparent');
});
it('respects reduced motion and never morphs one node into another',()=>{
 reduced=true;const ui=render(<CockpitTrend sparkId="a" port={8888} stale={false}/>);
 update();act(()=>ui.root.render(<CockpitTrend sparkId="a" port={8888} stale={false}/>));expect(queue.size).toBe(0);
 reduced=false;act(()=>ui.root.render(<CockpitTrend sparkId="b" port={8888} stale={false}/>));expect(queue.size).toBe(0);
});
it('cancels on hidden pages, stale data and unmount',()=>{
 const ui=render(<CockpitTrend sparkId="a" port={8888} stale={false}/>);update();act(()=>ui.root.render(<CockpitTrend sparkId="a" port={8888} stale={false}/>));expect(queue.size).toBe(1);
 hidden=true;act(()=>document.dispatchEvent(new Event('visibilitychange')));expect(queue.size).toBe(0);
 hidden=false;act(()=>document.dispatchEvent(new Event('visibilitychange')));expect(queue.size).toBe(0);
 act(()=>ui.root.render(<CockpitTrend sparkId="a" port={8888} stale/>));expect(ui.container.querySelector('canvas')).toBeNull();expect(queue.size).toBe(0);
 cleanupRenders();expect(queue.size).toBe(0);
});
