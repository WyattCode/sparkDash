import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ConnectivityJournal, cleanClientEvent, classifyProbeError, createConnectivityEvents} from '../../connectivityEvents.js';
import {SparkMonitor} from '../SparkMonitor.js';

test('journal survives replacement, bounds storage and reports malformed tail',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'connectivity-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'events.jsonl');const j=new ConnectivityJournal(file,{maxBytes:600,bootId:'old'});
  for(let i=0;i<20;i++)j.write({kind:'sample',number:i});
  assert.equal(fs.readdirSync(dir).length,3);
  for(const f of fs.readdirSync(dir))assert.ok(fs.statSync(path.join(dir,f)).size<=600);
  fs.appendFileSync(file,'{unfinished');
  const next=new ConnectivityJournal(file,{maxBytes:600,bootId:'new'});
  assert.equal(next.damagedLines,1);assert.equal(next.events.at(-1).number,19);
  next.write({kind:'server_start'});
  assert.equal(next.events.at(-1).bootId,'new');assert.ok(next.events.some(e=>e.bootId==='old'));
  assert.equal(new ConnectivityJournal(file).events.at(-1).kind,'server_start');
});

test('browser events whitelist fields and cannot forge server evidence',()=>{
  const b={kind:'snapshot_received',clientId:'tab1',browser:'firefox',states:[{id:'worker-fixture',online:false,password:'secret'}],source:'server',apiKey:'secret',at:1};
  const c=cleanClientEvent(b,['worker-fixture']);assert.equal(c.source,'browser');assert.equal(c.at,undefined);
  assert.ok(!JSON.stringify(c).includes('secret'));
  assert.equal(cleanClientEvent({...b,kind:'server_stop'},['worker-fixture']),null);
  assert.equal(cleanClientEvent({...b,states:[{id:'unknown',online:false}]},['worker-fixture']),null);
  assert.equal(classifyProbeError(Error('SSH banner exchange timed out secret')).category,'ssh_banner_timeout');
  assert.ok(!JSON.stringify(classifyProbeError(Error('password=secret'))).includes('secret'));
});

test('record failures during grace, offline transition and recovery without changing semantics',async()=>{
  const events=[];const m=new SparkMonitor({id:'worker-fixture',name:'worker-fixture',isLocal:false,lanIp:'127.0.0.1',llmMonitoring:false,comfyMonitoring:false},{onConnectivity:e=>events.push(e)});
  m._running=true;m._readUptime=async()=>123;
  await m._checkOnline();assert.equal(m.online,true);assert.equal(events.at(-1).kind,'probe_recovered');
  m._readUptime=async()=>{throw Error('Connection timed out during banner exchange');};
  await m._checkOnline();assert.equal(m.online,true);assert.equal(events.at(-1).kind,'probe_failure');assert.equal(events.at(-1).lastError.category,'ssh_banner_timeout');
  m.lastOnlineOk=Date.now()-11000;
  await m._checkOnline();assert.equal(m.online,false);assert.equal(events.at(-1).online,false);
  m._readUptime=async()=>124;await m._checkOnline();assert.equal(m.online,true);assert.equal(events.at(-1).previousFailures,2);
  assert.equal(m.snapshot().connectivity.phase,'online');
});

test('correlation survives Prometheus failure without changing node event',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'connectivity-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const r=createConnectivityEvents({file:path.join(dir,'events'),nodeIds:()=>['worker-fixture'],snapshots:()=>[],fetchImpl:async()=>{throw Error('offline');}});
  r.record({source:'monitor',kind:'probe_failure',node:'worker-fixture'});
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(r.journal.events[0].kind,'probe_failure');assert.equal(r.journal.events[1].available,false);
  assert.equal(r.journal.events[1].causeEventId,r.journal.events[0].eventId);
});
