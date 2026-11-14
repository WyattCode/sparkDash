import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {initiateSparkShutdown,inspectShutdownReadiness,createReadinessInspector,createShutdownLock,shutdownBatch} from '../../shutdown.js';
for (const cause of ['ENOENT','exit 1','timeout']) {
  test(`local shutdown rejects ${cause}, never returns early success`,async()=>{
    await assert.rejects(initiateSparkShutdown({isLocal:true},{localExec:async()=>{await Promise.resolve();throw new Error(cause);}}),/未确认/);
  });
}
test('container executes in host mount namespace and awaits completion',async()=>{
  let done=false;
  const message=await initiateSparkShutdown({isLocal:true},{container:true,localExec:async(cmd,args)=>{
    assert.equal(cmd,'nsenter');assert.deepEqual(args,['-t','1','-m','--','sudo','-n','/usr/local/bin/spark-shutdown']);
    await Promise.resolve();done=true;
  }});
  assert.equal(done,true);assert.match(message,/仍需确认/);
});
test('SSH disconnect does not prove shutdown succeeded',async()=>{
  await assert.rejects(initiateSparkShutdown({isLocal:false},{remoteExec:async()=>{throw new Error('ECONNRESET');}}),/ECONNRESET/);
});
test('power routes have no pre-acknowledgement callback',()=>{
  const source=fs.readFileSync(new URL('../../index.js',import.meta.url),'utf8');
  const power=source.slice(source.indexOf('// ─── Power management'));
  assert.ok(!power.includes('setImmediate('));
  assert.ok(power.includes('()=>shutdownBatch('));
});
for(const status of ['ready','missing-script','sudo-denied','unexpected'])test(`read-only dependency check: ${status}`,async()=>{
  const r=await inspectShutdownReadiness({id:'fixture',isLocal:true},{container:true,localExec:async(command,args)=>{
    assert.equal(command,'nsenter');assert.ok(args.includes('sh'));
    const script=args.at(-1);assert.match(script,/sudo -n -l/);assert.doesNotMatch(script,/sudo -n \/usr/);
    return {stdout:status};
  }});
  assert.equal(r.ready,status==='ready');assert.equal(r.status,status==='unexpected'?'unavailable':status);
});
test('dependency failures hide raw SSH errors and cache concurrent GET checks',async()=>{
  let count=0;
  const inspect=createReadinessInspector({remoteExec:async()=>{count++;throw Error('SECRET');}});
  const [a,b]=await Promise.all([inspect({id:'worker'}),inspect({id:'worker'})]);
  assert.equal(count,1);assert.equal(a.status,'unavailable');assert.equal(a.ready,false);assert.deepEqual(a,b);assert.ok(!JSON.stringify(a).includes('SECRET'));
  await inspect({id:'worker'},true);assert.equal(count,2);
});
test('batch preflight blocks the whole batch if any online dependency is missing',async()=>{
  const executed=[];
  const r=await shutdownBatch([{id:'worker'},{id:'head'}],{isOnline:()=>true,inspect:async s=>({ready:s.id==='worker',message:'missing-script'}),execute:async s=>executed.push(s.id)});
  assert.equal(r.success,false);assert.deepEqual(executed,[]);assert.equal(r.results[0].skipped,true);
});
test('batch stops after an unconfirmed command and preserves caller ordering',async()=>{
  const executed=[];
  const r=await shutdownBatch([{id:'worker'},{id:'head'}],{isOnline:()=>true,inspect:async()=>({ready:true}),execute:async s=>{executed.push(s.id);throw Error('unknown');}});
  assert.equal(r.success,false);assert.deepEqual(executed,['worker']);assert.equal(r.results[1].skipped,true);
});
test('batch executes ready nodes in order and skips offline nodes',async()=>{
  const executed=[];
  const r=await shutdownBatch([{id:'offline'},{id:'worker'},{id:'head'}],{isOnline:s=>s.id!=='offline',inspect:async()=>({ready:true}),execute:async s=>{executed.push(s.id);return 'accepted';}});
  assert.equal(r.success,true);assert.deepEqual(executed,['worker','head']);assert.equal(r.results[0].skipped,true);
});
test('overlapping single/batch commands are mutually exclusive and unlock on failure',async()=>{
  const lock=createShutdownLock();let finish;
  const running=lock(['head','worker'],()=>new Promise(resolve=>{finish=resolve;}));
  await assert.rejects(lock(['head'],async()=>{}),e=>e.status===409);
  assert.equal(await lock(['other'],async()=>42),42);finish();await running;
  await assert.rejects(lock(['head'],async()=>{throw Error('failed');}),/failed/);
  assert.equal(await lock(['head'],async()=>43),43);
});
