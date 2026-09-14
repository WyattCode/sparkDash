import {act} from 'react';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {ShowcasePage} from './ShowcasePage';
import {render,flush} from '../../testing/render';
import {makeSpark} from '../../testing/fixtures';
import * as api from '../../api/client';
import type {ShowcaseSessionState} from '../../api/types';
vi.mock('../../api/client',async original=>({
  ...await original<typeof import('../../api/client')>(),
  fetchSparks:vi.fn(),fetchSparkMetrics:vi.fn(),listDecodeBench:vi.fn(),listPrefillBench:vi.fn(),listShowcase:vi.fn(),
  startShowcase:vi.fn(),getShowcase:vi.fn(),cancelShowcase:vi.fn(),cancelShowcaseOnUnload:vi.fn(),
}));
const snapshot=(status='running')=>({sessionId:'owned',status,rev:1,streams:Array.from({length:4},(_,i)=>({streamId:String(i),status:status==='running'?'streaming':status,content:'保留的输出',reasoning:'',prompt:'fixture',tokenCount:1,decodeTps:1,liveTokPerSec:1,peakTokPerSec:1,error:null})),serverGenerationTps:1} as ShowcaseSessionState);
beforeEach(()=>{
  vi.useFakeTimers();
  vi.mocked(api.fetchSparks).mockResolvedValue({sparks:[{...makeSpark('test'),lanIp:'127.0.0.1',isLocal:true,ssh:{host:'127.0.0.1',user:'fixture',auth:'key'}}]});
  vi.mocked(api.fetchSparkMetrics).mockResolvedValue({metrics:{llm:[]}});
  vi.mocked(api.listDecodeBench).mockResolvedValue({active:null,history:[]} as never);
  vi.mocked(api.listPrefillBench).mockResolvedValue({active:null,history:[]} as never);
  vi.mocked(api.listShowcase).mockResolvedValue({active:null,history:[]});
  vi.mocked(api.startShowcase).mockResolvedValue({sessionId:'owned',status:'running'});
  vi.mocked(api.getShowcase).mockReset().mockResolvedValue(snapshot());
  vi.mocked(api.cancelShowcase).mockResolvedValue(snapshot('cancelled'));
  vi.spyOn(window,'confirm').mockReturnValue(true);
});
afterEach(()=>vi.useRealTimers());
const tick=async(ms:number)=>{await act(async()=>{await vi.advanceTimersByTimeAsync(ms);});await flush();};
async function setup(){const ui=render(<ShowcasePage sparkId="test"/>);await flush();await flush();return ui.container;}
const run=(c:HTMLElement)=>c.querySelector<HTMLButtonElement>('.showcase-btn--primary')!;
async function start(c:HTMLElement){await act(async()=>run(c).click());await flush();}
it('first result failure retains the session and retries reads, never repeats start',async()=>{
  vi.mocked(api.getShowcase).mockRejectedValueOnce(Error('短暂断线'));
  const c=await setup();await start(c);await tick(300);
  expect(c.textContent).toContain('自动重连');expect(run(c).disabled).toBe(true);
  await tick(1000);
  expect(api.getShowcase).toHaveBeenLastCalledWith('test','owned',undefined);
  expect(c.textContent).toContain('保留的输出');expect(c.textContent).not.toContain('自动重连');
  expect(api.startShowcase).toHaveBeenCalledTimes(1);
});
it('404 ends polling and permits a new run after checking availability',async()=>{
  vi.mocked(api.getShowcase).mockRejectedValueOnce(new api.ApiError('missing',404));
  const c=await setup();await start(c);await tick(300);await flush();
  expect(c.textContent).toContain('演示会话已不存在');expect(run(c).disabled).toBe(false);
  const count=vi.mocked(api.getShowcase).mock.calls.length;await tick(2000);
  expect(api.getShowcase).toHaveBeenCalledTimes(count);
});
it('late polling response cannot overwrite confirmed cancellation',async()=>{
  let finish!:(value:ReturnType<typeof snapshot>)=>void;
  vi.mocked(api.getShowcase).mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));
  const c=await setup();await start(c);await tick(300);
  await act(async()=>c.querySelector<HTMLButtonElement>('.showcase-btn--danger')!.click());await flush();
  await act(async()=>finish(snapshot()));await flush();
  expect(run(c).disabled).toBe(false);expect(c.querySelector('.showcase-btn--danger')).toBeNull();
});
it('existing showcase blocks start without posting',async()=>{
  vi.mocked(api.listShowcase).mockResolvedValue({active:{sessionId:'other',status:'running'},history:[]});
  const c=await setup();expect(run(c).disabled).toBe(true);expect(c.textContent).toContain('原演示窗口');expect(api.startShowcase).not.toHaveBeenCalled();
});
it('navigation events cancel only once with the owned session',async()=>{
  const c=await setup();await start(c);
  act(()=>{window.dispatchEvent(new Event('beforeunload'));window.dispatchEvent(new Event('pagehide'));});
  expect(api.cancelShowcaseOnUnload).toHaveBeenCalledExactlyOnceWith('test','owned');
});
