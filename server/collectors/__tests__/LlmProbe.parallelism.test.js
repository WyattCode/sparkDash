import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LlmProbe} from '../LlmProbe.js';

test('parallelism comes from actual server-info fields, not node count',()=>{
 const p=new LlmProbe({isLocal:true},8888);
 p._applySglangServerInfo({server_args:{tp_size:4,ep_size:1}},1);
 assert.deepEqual(p.parallelism,{tensor:4,expert:1});
 p.serverIsOpenAI=true;p.authOpen=true;
 assert.deepEqual(p._getSnapshot().parallelism,{tensor:4,expert:1});
 p._resetDetection();assert.equal(p.parallelism,null);
 assert.equal(p._defaultLlm().parallelism,null);
});
test('missing or invalid parallel settings remain unknown and replace prior facts',()=>{
 const p=new LlmProbe({isLocal:true},8888);
 p._applySglangServerInfo({tp_size:2,ep_size:1},1);
 assert.deepEqual(p.parallelism,{tensor:2,expert:1});
 for(const value of [0,-1,1.5,'4',NaN,undefined]){
  p._applySglangServerInfo({server_args:{tp_size:value,ep_size:value}},1);
  assert.equal(p.parallelism,null);
 }
});
