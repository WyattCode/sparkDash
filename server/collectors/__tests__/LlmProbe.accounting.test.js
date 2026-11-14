import test from 'node:test';
import assert from 'node:assert/strict';
import {LlmProbe} from '../LlmProbe.js';

test('accounting deduplicates TP ranks but sums streaming and non-streaming counters',()=>{
  const p=new LlmProbe({isLocal:true},8888);p.modelId='m';
  p._applySglangAccounting([
    'sglang:generation_tokens_total{is_streaming="true",tp_rank="0",model_name="m"} 100',
    'sglang:generation_tokens_total{is_streaming="true",tp_rank="1",model_name="m"} 100',
    'sglang:generation_tokens_total{is_streaming="false",model_name="m"} 5',
    'sglang:generation_tokens_total{model_name="other"} 10000',
    'sglang:prefill_effective_tokens_total{mode="input",tp_rank="0"} 30',
    'sglang:prefill_effective_tokens_total{mode="input",tp_rank="1"} 30',
    'sglang:prefill_effective_tokens_total{mode="device_hit",tp_rank="0"} 70',
    'sglang:prefill_effective_tokens_total{mode="device_hit",tp_rank="1"} 70',
    'sglang:prefill_effective_tokens_total{mode="host_hit"} 10',
    'sglang:token_usage{tp_rank="0"} 0.2','sglang:token_usage{tp_rank="1"} 0.2',
    'sglang:kv_cache_memory_usage_gb 0',
  ].join('\n'));
  assert.deepEqual(p.tokenCounters,{output:105,prompt:110,cached:80,source:'sglang:prometheus:effective'});
  assert.equal(p.kvCacheUsage,0.2);assert.equal(p.kvCacheGb,null);
});
test('KV token ratio and memory report use single scheduler units; missing values remain null',()=>{
  const p=new LlmProbe({isLocal:true},8888);
  p._applySglangServerInfo({internal_states:[{memory_usage:{weight:42,kvcache:8}},{memory_usage:{weight:42,kvcache:8}}]},1);
  p._applySglangAccounting('sglang:kv_used_tokens 30\nsglang:max_total_num_tokens 100');
  assert.equal(p.weightsGb,42);assert.equal(p.kvCacheGb,8);assert.equal(p.kvCacheUsage,0.3);
  p._applySglangAccounting('sglang:token_usage 5');assert.equal(p.kvCacheUsage,null);
  p._resetDetection();assert.equal(p.weightsGb,null);assert.equal(p.kvCacheGb,null);assert.equal(p.tokenCounters,null);
});
test('missing cache split is not reported as zero; safe input source switches are explicit',()=>{
  const p=new LlmProbe({isLocal:true},8888);
  p._applySglangAccounting('sglang_generation_tokens_total 5\nsglang_prompt_tokens_total 20');
  assert.equal(p.tokenCounters.cached,null);assert.equal(p.tokenCounters.prompt,20);
  assert.equal(p.tokenCounters.source,'sglang:prometheus:prompt');
  p._applySglangServerInfo({total_output_tokens:30,total_input_tokens:100},1);
  assert.equal(p.tokenCounters.source,'sglang:server_info');assert.equal(p.tokenCounters.cached,null);
});
test('probe clears accounting fields before a failed request',async()=>{
  const p=new LlmProbe({isLocal:true},8888);p.tokenCounters={output:10};p.weightsGb=40;p.kvCacheGb=8;p.kvCacheUsage=.2;
  p._detectServerType=async()=>{throw Error('offline');};await p.probe();
  assert.equal(p.tokenCounters,null);assert.equal(p.weightsGb,null);assert.equal(p.kvCacheGb,null);assert.equal(p.kvCacheUsage,null);
});
test('served model identity wins over the transient server-info filesystem path',()=>{
  const p=new LlmProbe({isLocal:true},8888);p.modelId='/model';
  p._applySglangAccounting('sglang:generation_tokens_total{model_name="served-model"} 42','served-model');
  assert.equal(p.tokenCounters.output,42);
});
