import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createConnectivityReporter} from './connectivityReporter';

beforeEach(()=>{sessionStorage.clear();vi.useFakeTimers();});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it('queues outage evidence then drains on recovery, including offline and online states',async()=>{
  const send=vi.fn().mockRejectedValueOnce(Error('network down')).mockResolvedValue({ok:true,status:202});vi.stubGlobal('fetch',send);
  const r=createConnectivityReporter();r.record('ws_close',{closeCode:1006});
  await vi.advanceTimersByTimeAsync(1);
  expect(JSON.parse(sessionStorage.getItem('sparkdash-connectivity-pending-v1')||'[]')).toHaveLength(1);
  r.record('snapshot_received',{states:[{id:'worker-fixture',online:false}],serverBootId:'boot1'});
  r.record('snapshot_applied',{states:[{id:'worker-fixture',online:true}],serverBootId:'boot2'});
  await vi.advanceTimersByTimeAsync(1);
  const sent=send.mock.calls.slice(1).map(c=>JSON.parse(c[1].body));
  expect(sent.map(e=>e.kind)).toEqual(['ws_close','snapshot_received','snapshot_applied']);
  expect(sent[1].states[0]).toEqual({id:'worker-fixture',online:false});
  expect(JSON.parse(sessionStorage.getItem('sparkdash-connectivity-pending-v1')||'[]')).toHaveLength(0);
  r.dispose();
});
it('bounds storage while disconnected and stops retries on disposal',async()=>{
  const send=vi.fn().mockRejectedValue(Error('offline'));vi.stubGlobal('fetch',send);
  const r=createConnectivityReporter();for(let i=0;i<100;i++)r.record('ws_error');
  await vi.advanceTimersByTimeAsync(1);r.dispose();const count=send.mock.calls.length;
  await vi.advanceTimersByTimeAsync(20000);
  expect(send).toHaveBeenCalledTimes(count);
  expect(JSON.parse(sessionStorage.getItem('sparkdash-connectivity-pending-v1')||'[]')).toHaveLength(64);
});
it('an old in-flight response cannot overwrite a replacement reporter queue',async()=>{
  let resolveOld:(v:unknown)=>void=()=>{};
  const send=vi.fn().mockImplementationOnce(()=>new Promise(r=>{resolveOld=r;})).mockRejectedValue(Error('offline'));
  vi.stubGlobal('fetch',send);
  const old=createConnectivityReporter();old.record('ws_close');old.dispose();
  const next=createConnectivityReporter();next.record('ws_open');
  await vi.advanceTimersByTimeAsync(1);
  resolveOld({ok:true,status:202});await vi.advanceTimersByTimeAsync(1);
  const saved=JSON.parse(sessionStorage.getItem('sparkdash-connectivity-pending-v1')||'[]');
  expect(saved.map((e:{kind:string})=>e.kind)).toEqual(['ws_close','ws_open']);next.dispose();
});
