import test from 'node:test';
import assert from 'node:assert/strict';
import {LlmProbe} from '../LlmProbe.js';
const metrics=(output=100,input=50)=>`tensorfold_health:completion_tokens_total ${output}
tensorfold:generation_tokens_total ${output}
tensorfold:prompt_tokens_total ${input}
tensorfold_health:cached_tokens_total 10
tensorfold:requests_running 1
tensorfold:requests_waiting 2
tensorfold_health:context_length 1048576
tensorfold_health:streams_max 8
tensorfold_health:pool_tokens 1000
tensorfold_health:pool_free_tokens 700
tensorfold:mtp_drafted_total 20
tensorfold:mtp_accepted_total 10
tensorfold:time_to_first_token_seconds_sum 10
tensorfold:time_to_first_token_seconds_count 2
`;
test('TensorFold rebases counters, uses live output and completion input, exposes only native capabilities',()=>{
  const p=new LlmProbe({});p.modelId='GLM-5.3-Flash-EXL3';
  p._applyTensorFoldMetrics(metrics(),1);
  assert.equal(p.generationTps,0);assert.equal(p.prefillTps,0);
  p._applyTensorFoldMetrics(metrics(120,60),2);
  assert.equal(p.generationTps,10);assert.equal(p.prefillTps,5);
  assert.equal(p.requestsRunning,1);assert.equal(p.requestsWaiting,2);
  assert.equal(p.kvCacheUsage,.3);assert.equal(p.contextLength,1048576);assert.equal(p.slotsTotal,8);
  assert.equal(p.mtpAcceptanceRate,.5);assert.equal(p.gpuMemoryUtilization,null);
  assert.equal(p.itlP95Seconds,null);assert.equal(p.preemptionsTotal,null);
  assert.deepEqual(p.tokenCounters,{source:'tensorfold:health+prometheus',output:120,prompt:60,cached:10});
  p._applyTensorFoldMetrics(metrics(1,1),1);
  assert.equal(p.generationTps,0);assert.equal(p.prefillTps,0);
});
test('TensorFold missing live counters cannot leave a previous success rate',()=>{
  const p=new LlmProbe({});p.modelId='GLM-5.3-Flash-EXL3';
  assert.throws(()=>p._applyTensorFoldMetrics('tensorfold:requests_running 0',1),/unavailable/);
});
test('TensorFold live output does not depend on a completed-output metric line',()=>{
  const p=new LlmProbe({});p.modelId='GLM-5.3-Flash-EXL3';
  const live=(output,input)=>metrics(output,input).replace(/^tensorfold:generation_tokens_total .*\n/m,'');
  p._applyTensorFoldMetrics(live(100,50),1);
  p._applyTensorFoldMetrics(live(120,60),2);
  assert.equal(p.generationTps,10);assert.equal(p.totalOutputTokens,120);assert.equal(p.prefillTps,5);
});
