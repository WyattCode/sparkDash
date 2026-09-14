import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ShowcaseManager} from '../ShowcaseManager.js';

function fixture() {
  // No constructor, filesystem, timers or network. Exercise real manager methods.
  const manager=Object.create(ShowcaseManager.prototype);
  const session={sparkId:'test',sessionId:'s',status:'running',rev:1,thinking:false,_abort:new AbortController(),streams:[{streamId:'0',status:'streaming',content:'A',reasoning:'R'}],_snapshotOffsets:new Map()};
  manager.sessions=new Map([['s',session]]);manager.activeBySpark=new Map([['test','s']]);
  manager._archiveSession=()=>{};
  return {manager,session};
}
test('lost responses and independent readers do not advance another client cursor',()=>{
  const {manager:m,session:s}=fixture();m.getSession('test','s');
  s.streams[0].content='AB';s.streams[0].reasoning='RS';s.rev=2;
  const first=m.getSession('test','s',1);m.getSession('test','s');
  const retry=m.getSession('test','s',1);
  assert.equal(first.streams[0].contentAppend,'B');assert.equal(retry.streams[0].contentAppend,'B');assert.equal(retry.streams[0].reasoningAppend,'S');
});
test('revision cache is bounded and evicted revisions receive full output',()=>{
  const {manager:m,session:s}=fixture();
  for(let i=1;i<100;i++){s.rev=i;s.streams[0].content+='x';m.getSession('test','s');}
  assert.equal(s._snapshotOffsets.size,64);
  assert.equal(m.getSession('test','s',1).streams[0].content,s.streams[0].content);
});
test('cancel retains admission lock while requests settle',()=>{
  const {manager:m}=fixture();m.cancel('test','s');
  assert.equal(m.getActive('test').status,'cancelling');
  assert.throws(()=>m.start({sparkId:'test'}),{status:409});
});
test('real async cleanup releases only its own lock and preserves cancelled status',async()=>{
  const {manager:m,session:s}=fixture();
  let finish;
  m._streamRequest=()=>new Promise(resolve=>{finish=resolve;});
  m._ratePoll=async()=>({median:null,max:null,samples:0});
  const running=m._runSession(s);
  m.cancel('test','s');
  assert.equal(m.getActive('test').status,'cancelling');
  // Even if future recovery code replaces the owner, old cleanup must be safe.
  m.activeBySpark.set('test','new-owner');
  finish({error:'aborted',completionTokens:0});await running;
  assert.equal(m.activeBySpark.get('test'),'new-owner');
  assert.equal(s.streams[0].status,'cancelled');
});
test('cancelled requests settle and free admission despite metrics polling failure',async()=>{
  const {manager:m,session:s}=fixture();
  let finish;
  m._streamRequest=()=>new Promise(resolve=>{finish=resolve;});
  m._ratePoll=async()=>{throw Error('metrics offline');};
  const running=m._runSession(s);m.cancel('test','s');
  finish({error:'HTTP 400',completionTokens:0});await running;
  assert.equal(m.getActive('test'),null);assert.equal(s.streams[0].status,'cancelled');
});
