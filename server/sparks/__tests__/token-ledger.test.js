import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LlmTokenLedger,extractTokenObservations} from '../../llmtokens/LlmTokenLedger.js';
import {createLlmTokenRuntime} from '../../llmtokens/LlmTokenRuntime.js';

const now=Date.UTC(2026,9,9,10);
const obs=(output,prompt=output*2,cached=output,other={})=>({sparkId:'head',port:8888,modelId:'model-a',source:'test',output,prompt,cached,...other});
const row=ledger=>ledger.snapshot('all',now).rows[0];

test('first observation seeds; cache is a subset and cannot inflate prompt totals',()=>{
  const l=new LlmTokenLedger();l.record([obs(100)],now);assert.equal(row(l),undefined);
  l.record([obs(110,220,500)],now+15000);
  assert.equal(row(l).completionTokens,10);assert.equal(row(l).promptTokens,20);assert.equal(row(l).cachedTokens,20);
});
test('model/source/reset/gap boundaries re-seed instead of crossing counters',()=>{
  const l=new LlmTokenLedger();l.record([obs(100)],now);
  l.record([obs(200,400,200,{modelId:'model-b'})],now+15000);assert.equal(row(l),undefined);
  l.record([obs(300,600,300,{modelId:'model-b',source:'different'})],now+30000);assert.equal(row(l),undefined);
  l.record([obs(5,10,5,{modelId:'model-b',source:'different'})],now+45000);assert.equal(row(l),undefined);
  l.record([obs(10,20,10,{modelId:'model-b',source:'different'})],now+105000);assert.equal(row(l),undefined);
  l.record([obs(15,30,15,{modelId:'model-b',source:'different'})],now+120000);
  assert.equal(row(l).completionTokens,5);assert.equal(row(l).modelId,'model-b');
});
test('missing observations and backward clock invalidate transient baselines',()=>{
  const l=new LlmTokenLedger();l.record([obs(100)],now);l.record([],now+15000);
  l.record([obs(200)],now+30000);assert.equal(row(l),undefined);
  l.record([obs(300)],now+10000);assert.equal(row(l),undefined);
  l.record([obs(310)],now+20000);assert.equal(row(l).completionTokens,10);
});
test('unknown prompt/cache remains unknown, not a fabricated zero',()=>{
  const l=new LlmTokenLedger();l.record([obs(100,null,null)],now);l.record([obs(110,null,null)],now+15000);
  assert.equal(row(l).promptTokens,null);assert.equal(row(l).cachedTokens,null);
});
test('parallel endpoints are separate; duplicate samples in one tick are not double-counted',()=>{
  const l=new LlmTokenLedger();l.record([obs(0),obs(0,0,0,{port:8889})],now);
  l.record([obs(10),obs(20),obs(5,10,5,{port:8889})],now+15000);
  assert.equal(l.snapshot('all',now).rows.reduce((n,r)=>n+r.completionTokens,0),15);
});
test('UTC ranges and invalid range keys are safe',()=>{
  const l=new LlmTokenLedger();l.record([obs(0)],now-15000);l.record([obs(10)],now);
  assert.equal(l.snapshot('today',now+86400000).rows.length,0);
  assert.equal(l.snapshot('7d',now+86400000).rows[0].completionTokens,10);
  assert.equal(l.snapshot('__proto__',now).range,'today');
  assert.equal(l.snapshot({toString:()=> 'constructor'},now).range,'today');
});
test('restart preserves totals but never credits downtime counters; write failures remain retryable',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'token-ledger-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'ledger.json');const l=new LlmTokenLedger(file);
  l.record([obs(0)],now);l.record([obs(10)],now+15000);l.flush();
  const reloaded=new LlmTokenLedger(file);reloaded.record([obs(1000)],now+30000);
  assert.equal(row(reloaded).completionTokens,10);assert.equal(fs.statSync(file).mode&0o777,0o600);
  reloaded.record([obs(1010)],now+45000);const saved=fs.readFileSync(file,'utf8');
  const write=reloaded._write;reloaded._write=()=>{throw Error('disk failure');};
  assert.throws(()=>reloaded.flush(),/disk failure/);assert.equal(fs.readFileSync(file,'utf8'),saved);
  assert.equal(reloaded.dirty,true);assert.ok(reloaded.snapshot().persistenceError);
  reloaded._write=write;reloaded.flush();assert.equal(row(new LlmTokenLedger(file)).completionTokens,20);
});
test('corrupt history cannot be overwritten by automatic flush',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'token-corrupt-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'ledger.json');fs.writeFileSync(file,'{broken');const l=new LlmTokenLedger(file);
  l.record([obs(0)],now);l.record([obs(10)],now+15000);assert.throws(()=>l.flush());
  assert.equal(fs.readFileSync(file,'utf8'),'{broken');
});
test('extractor excludes workers, stale/offline/missing counters and invalid ports',()=>{
  const good={id:'head',online:true,role:'head',llmPorts:[8888],telemetry:{updatedAt:{llm:now}},metrics:{llm:[{available:true,modelId:'m',tokenCounters:{output:10,prompt:20,cached:5,source:'s'}}]}};
  assert.equal(extractTokenObservations([good],now).length,1);
  for(const bad of [{...good,role:'worker'},{...good,online:false},{...good,llmPorts:[0]},
    {...good,telemetry:{updatedAt:{llm:now-10001}}},{...good,metrics:{llm:[{available:true,totalOutputTokens:10}]}}]){
    assert.equal(extractTokenObservations([bad],now).length,0);
  }
});
test('runtime is read-only over snapshots, starts once and flushes on stop',()=>{
  let starts=0,clears=0,flushed=0,records=0;
  const runtime=createLlmTokenRuntime({ledger:{record(){records++;},flush(){flushed++;}},orderedSnapshots:()=>[],setIntervalFn(){starts++;return 1;},clearIntervalFn(){clears++;}});
  runtime.start();runtime.start();runtime.stop();runtime.stop();
  assert.equal(starts,1);assert.equal(clears,1);assert.equal(flushed,1);assert.equal(records,1);
});
