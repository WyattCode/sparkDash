import test from 'node:test';
import assert from 'node:assert/strict';
import { LlmProbe } from '../LlmProbe.js';

test('probe reset also resets the rate clock before seeding lifetime counters',()=>{
  const probe=new LlmProbe({});probe.lastProbeTime=Date.now()-1000;
  probe.lastTokenCounts={input:100,output:100};probe._resetDetection();
  assert.equal(probe.lastProbeTime,0);
});

test('one resetting llama.cpp slot cannot cancel another slot output',async t=>{
  const now=Date.now();t.mock.method(Date,'now',()=>now);
  const probe=new LlmProbe({});probe.lastProbeTime=Date.now()-2000;
  probe.slotState.set(0,{decoded:100,prompted:50});
  probe.slotState.set(1,{decoded:50,prompted:50});
  probe._fetch=async url=>({ok:true,status:200,json:async()=>String(url).endsWith('/slots')?
    [{id:0,state:'processing',n_decoded:0,n_prompt_tokens_processed:0},{id:1,state:'processing',n_decoded:70,n_prompt_tokens_processed:50}]:{}});
  await probe._probeLlamaCpp();
  assert.ok(probe.generationTps>8 && probe.generationTps<=10,`rate ${probe.generationTps}`);
});

test('the first recovered vLLM poll seeds counters; the next reports only its delta',async t=>{
  let now=100000,output=900000;
  t.mock.method(Date,'now',()=>now);
  const probe=new LlmProbe({});probe.lastProbeTime=now-1000;probe._resetDetection();
  probe.serverIsOpenAI=true;probe.backendType='vllm';
  probe._fetch=async url=>String(url).endsWith('/metrics')?
    {ok:true,status:200,text:async()=>`vllm:prompt_tokens_total 100\nvllm:generation_tokens_total ${output}\n`}:
    {ok:true,status:200,json:async()=>({data:[{id:'fixture',owned_by:'vllm'}]})};
  await probe._probeOpenAICompatible();assert.equal(probe.generationTps,0);
  now+=1000;output+=20;
  await probe._probeOpenAICompatible();assert.equal(probe.generationTps,20);
});
