import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { render, flush } from '../testing/render';
import { useShowcaseAvailability } from './useShowcaseAvailability';
import { listDecodeBench, listPrefillBench, listShowcase } from '../api/client';
vi.mock('../api/client',()=>({listDecodeBench:vi.fn(),listPrefillBench:vi.fn(),listShowcase:vi.fn()}));
function Probe({id='a',enabled=true}:{id?:string;enabled?:boolean}) {
  const state=useShowcaseAvailability(id,enabled);
  return <div><pre>{JSON.stringify(state)}</pre><button onClick={()=>void state.refresh()}>刷新</button></div>;
}
const state=()=>JSON.parse(document.querySelector('pre')!.textContent!);
function setup() {
  vi.useFakeTimers();
  vi.mocked(listPrefillBench).mockResolvedValue({active:null,history:[]} as never);
  vi.mocked(listShowcase).mockResolvedValue({active:null,history:[]});
}
afterEach(()=>vi.useRealTimers());
it('releases the in-flight guard after an error so the next poll can recover',async()=>{
  setup();
  vi.mocked(listDecodeBench).mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({active:null,history:[]} as never);
  render(<Probe/>);await flush();
  expect(state().checking).toBe(false);
  expect(state().message).toContain('暂不可用');
  act(()=>vi.advanceTimersByTime(15000));await flush();
  expect(state()).toMatchObject({checking:false,message:null});
  expect(listDecodeBench).toHaveBeenCalledTimes(2);
});
it('coalesces slow polling and manual refresh, accepting the eventual response',async()=>{
  setup();
  let finish!:(value:never)=>void;
  vi.mocked(listDecodeBench).mockReturnValue(new Promise(resolve=>{finish=resolve;}));
  render(<Probe/>);
  act(()=>{vi.advanceTimersByTime(45000);document.querySelector('button')!.click();});
  expect(listDecodeBench).toHaveBeenCalledTimes(1);
  expect(state().checking).toBe(true);
  await act(async()=>finish({active:null,history:[]} as never));
  expect(state()).toMatchObject({checking:false,message:null});
  act(()=>vi.advanceTimersByTime(15000));await flush();
  expect(listDecodeBench).toHaveBeenCalledTimes(2);
});
it('ignores the previous node response and clears checking when disabled',async()=>{
  setup();
  let finish!:(value:never)=>void;
  vi.mocked(listDecodeBench).mockImplementation(id=>id==='a'
    ? new Promise(resolve=>{finish=resolve;})
    : Promise.resolve({active:null,history:[]} as never));
  const {root}=render(<Probe/>);
  act(()=>root.render(<Probe id="b"/>));await flush();
  expect(state()).toMatchObject({checking:false,message:null});
  await act(async()=>finish({active:{id:'old'},history:[]} as never));
  expect(state()).toMatchObject({checking:false,message:null});
  act(()=>root.render(<Probe id="a"/>));
  expect(state().checking).toBe(true);
  act(()=>root.render(<Probe id="a" enabled={false}/>));
  expect(state().checking).toBe(false);
});
