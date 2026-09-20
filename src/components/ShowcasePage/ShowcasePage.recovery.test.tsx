import {act} from 'react';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {ShowcasePage} from './ShowcasePage';
import {render,flush} from '../../testing/render';
import {makeSpark} from '../../testing/fixtures';
import * as api from '../../api/client';
import type {ShowcaseHistorySummary,ShowcaseSessionState} from '../../api/types';
vi.mock('../../api/client',async original=>({
  ...await original<typeof import('../../api/client')>(),
  fetchSparks:vi.fn(),fetchSparkMetrics:vi.fn(),listDecodeBench:vi.fn(),listPrefillBench:vi.fn(),listShowcase:vi.fn(),
  startShowcase:vi.fn(),getShowcase:vi.fn(),cancelShowcase:vi.fn(),cancelShowcaseOnUnload:vi.fn(),clearShowcaseHistory:vi.fn(),
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
  vi.mocked(api.clearShowcaseHistory).mockResolvedValue({success:true});
  vi.spyOn(window,'confirm').mockReturnValue(true);
});
afterEach(()=>vi.useRealTimers());
const tick=async(ms:number)=>{await act(async()=>{await vi.advanceTimersByTimeAsync(ms);});await flush();};
async function setup(){const ui=render(<ShowcasePage sparkId="test"/>);await flush();await flush();return ui.container;}
const run=(c:HTMLElement)=>c.querySelector<HTMLButtonElement>('.showcase-btn--primary')!;
async function start(c:HTMLElement){await act(async()=>run(c).click());await flush();}
it('keeps the page title and icon navigation without a duplicate topbar caption',async()=>{
  const c=await setup();
  expect(c.textContent).not.toContain('模型工具 / 并发生成测试');
  expect(c.querySelector('.sw-topbar__section')).toBeNull();
  expect(c.querySelector('h1')?.textContent).toBe('并发生成测试 - 对比生成表现');
  const back=c.querySelector<HTMLAnchorElement>('.sw-back');
  expect(back?.getAttribute('href')).toBe('/');
  expect(back?.getAttribute('aria-label')).toBe('概览');
  expect(back?.getAttribute('title')).toBe('概览');
  expect(back?.textContent).toBe('');
  expect(back?.querySelector('svg')).not.toBeNull();
});
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

const clickText=async(c:HTMLElement,text:string)=>{
  const b=[...c.querySelectorAll<HTMLButtonElement>('button')].find(e=>e.textContent?.startsWith(text));
  expect(b).toBeTruthy();await act(async()=>b!.click());await flush();
};
const setInput=async(el:HTMLInputElement|HTMLTextAreaElement,value:string)=>{
  const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
  await act(async()=>{Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));});
};
const historyRow={sessionId:'saved',sparkId:'test',status:'completed',port:8888,modelId:'history-model',maxTokens:512,temperature:0.7,thinking:false,promptType:'mixed',totalTokens:4,meanDecodeTps:1,peakStreamTps:1,streamCount:4} as ShowcaseHistorySummary;
const saved=()=>({...snapshot('completed'),sessionId:'saved',port:8888,maxTokens:512,temperature:0.7,modelId:'history-model',fromHistory:true});
function withHistory(){vi.mocked(api.listShowcase).mockResolvedValue({active:null,history:[historyRow]});}

it('a late history refresh cannot restore records after clearing',async()=>{
  withHistory();const c=await setup();
  let finish!:(v:Awaited<ReturnType<typeof api.listShowcase>>)=>void;
  vi.mocked(api.listShowcase).mockReturnValueOnce(new Promise(r=>{finish=r;}));
  await clickText(c,'历史记录');
  await clickText(c,'清空历史');
  expect(api.clearShowcaseHistory).toHaveBeenCalledWith('test');
  await act(async()=>finish({active:null,history:[historyRow]}));await flush();
  expect(c.querySelectorAll('.sw-history-list li')).toHaveLength(0);
  expect(c.textContent).toContain('暂无历史记录');
});

it('keeps the same workbench mounted while node loading and availability checks finish',async()=>{
  let resolve!:(v:Awaited<ReturnType<typeof api.fetchSparks>>)=>void;
  vi.mocked(api.fetchSparks).mockReturnValueOnce(new Promise(r=>{resolve=r;}));
  const c=await setup();
  const layout=c.querySelector('.sw-layout');
  expect(layout).not.toBeNull();expect(run(c).disabled).toBe(true);
  expect(c.querySelector('.sw-notice')).toBeNull();
  await act(async()=>resolve({sparks:[{...makeSpark('test'),lanIp:'127.0.0.1',isLocal:true,ssh:{host:'127.0.0.1',user:'fixture',auth:'key'}}]}));await flush();
  expect(c.querySelector('.sw-layout')).toBe(layout);
  expect(c.querySelector('.sw-notice')).toBeNull();
});
it('balances only the default view, not expanded configuration or history/results',async()=>{
  withHistory();vi.mocked(api.getShowcase).mockResolvedValue(saved());
  const c=await setup();
  expect(c.querySelector('.sw-layout--balanced')).not.toBeNull();
  await clickText(c,'编辑提示词');expect(c.querySelector('.sw-layout--balanced')).toBeNull();
  await clickText(c,'编辑提示词');expect(c.querySelector('.sw-layout--balanced')).not.toBeNull();
  await clickText(c,'历史记录');expect(c.querySelector('.sw-layout--balanced')).toBeNull();
  await clickText(c,'查看结果');expect(c.querySelector('.sw-layout--balanced')).toBeNull();
});

it('switching historical sessions replaces peak, model and optional server throughput',async()=>{
  withHistory();
  const first=saved();
  first.serverGenerationTps=987;
  first.streams.forEach(s=>{s.peakTokPerSec=654;});
  const second={...saved(),sessionId:'second',modelId:null,serverGenerationTps:null};
  vi.mocked(api.getShowcase).mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  const writeText=vi.fn().mockResolvedValue(undefined);
  const clipboardDescriptor=Object.getOwnPropertyDescriptor(navigator,'clipboard');
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}});
  try {
    const c=await setup();
    await clickText(c,'历史记录');await clickText(c,'查看结果');await clickText(c,'复制结果');
    expect(writeText.mock.calls[0][0]).toContain('峰值 654.0');
    expect(writeText.mock.calls[0][0]).toContain('服务端 987.0');
    await clickText(c,'历史记录');await clickText(c,'查看结果');
    await tick(1500);await clickText(c,'复制结果');
    const copied=writeText.mock.calls[1][0];
    expect(copied).toContain('峰值 1.0');
    expect(copied).not.toContain('654.0');
    expect(copied).not.toContain('服务端');
    expect(copied).not.toContain('history-model');
    expect(api.startShowcase).not.toHaveBeenCalled();
  } finally {
    if(clipboardDescriptor)Object.defineProperty(navigator,'clipboard',clipboardDescriptor);
    else Reflect.deleteProperty(navigator,'clipboard');
  }
});

it('ready state is one useful empty panel, not blank terminal windows',async()=>{
  const c=await setup();expect(c.textContent).toContain('从一次并发生成开始');expect(c.querySelectorAll('.showcase-term')).toHaveLength(0);
  expect(api.startShowcase).not.toHaveBeenCalled();
});
it('blank prompts are rejected without silently reducing concurrency',async()=>{
  const c=await setup();await clickText(c,'编辑提示词');
  await setInput(c.querySelector('textarea')!,'   ');await start(c);
  expect(c.textContent).toContain('每个请求都需要提示词');expect(api.startShowcase).not.toHaveBeenCalled();
});
it.each(['', '63', '2049', '512.5'])('invalid output limit %s never posts a generation request',async(value)=>{
  const c=await setup();await setInput(c.querySelector<HTMLInputElement>('input[type=number]')!,value);await start(c);
  expect(c.textContent).toContain('输出上限须为');expect(api.startShowcase).not.toHaveBeenCalled();
});
it('historical result is read-only and layout toggles do not start generation',async()=>{
  withHistory();vi.mocked(api.getShowcase).mockResolvedValue(saved());
  const c=await setup();await clickText(c,'历史记录');await clickText(c,'查看结果');
  expect(c.textContent).toContain('历史记录 · 已完成');expect(c.querySelectorAll('.showcase-term')).toHaveLength(4);
  expect(c.querySelector('#sw-settings')?.hasAttribute('hidden')).toBe(false);
  await clickText(c,'列表');expect(c.querySelector('.sw-streams--list')).not.toBeNull();
  act(()=>window.dispatchEvent(new Event('pagehide')));
  expect(api.startShowcase).not.toHaveBeenCalled();expect(api.cancelShowcaseOnUnload).not.toHaveBeenCalled();
});
it('history reuse locks start until complete and removes stale results without running',async()=>{
  withHistory();vi.mocked(api.getShowcase).mockResolvedValue(saved());
  const c=await setup();await clickText(c,'历史记录');await clickText(c,'查看结果');await clickText(c,'历史记录');
  let finish!:(v:ShowcaseSessionState)=>void;
  vi.mocked(api.getShowcase).mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));
  await clickText(c,'复用配置');expect(run(c).disabled).toBe(true);
  await act(async()=>finish(saved()));await flush();
  expect(run(c).disabled).toBe(false);expect(c.querySelectorAll('.showcase-term')).toHaveLength(0);
  expect(c.querySelectorAll('textarea')).toHaveLength(4);expect(api.startShowcase).not.toHaveBeenCalled();
});
it('history failures display a retryable message, not a false empty state',async()=>{
  vi.mocked(api.listShowcase).mockRejectedValue(Error('offline'));
  const c=await setup();await clickText(c,'历史记录');
  expect(c.textContent).toContain('历史记录暂时无法加载');expect(c.textContent).not.toContain('暂无历史记录');
});
it('current aggregate excludes completed streams',async()=>{
  const state=snapshot();state.streams[0].status='completed';state.streams[0].decodeTps=999;state.streams[0].liveTokPerSec=999;
  vi.mocked(api.getShowcase).mockResolvedValue(state);
  const c=await setup();await start(c);await tick(300);
  expect(c.querySelector('.sw-metrics > div:first-child strong')?.textContent).toBe('3.0tok/s');
});
it('history never takes ownership of another running session',async()=>{
  withHistory();vi.mocked(api.getShowcase).mockResolvedValue(snapshot());
  const c=await setup();await clickText(c,'历史记录');await clickText(c,'查看结果');
  expect(c.textContent).toContain('此记录仍在运行');
  act(()=>window.dispatchEvent(new Event('pagehide')));
  expect(api.cancelShowcaseOnUnload).not.toHaveBeenCalled();expect(c.querySelector('.showcase-btn--danger')).toBeNull();
});
