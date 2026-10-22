import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {LlmProbe} from '../LlmProbe.js';

test('Zig TensorFold health: queue count, live rates, unknown counters and idle reset',async()=>{
 const p=new LlmProbe({lanIp:'10.77.0.1'},8888);
 p.serverIsOpenAI=true;
 let live={connections:5,waiting:2,decode_tokens_per_second:150.5,prefill_tokens_per_second:2600};
 p._fetch=async url=>({ok:true,status:200,json:async()=>String(url).endsWith('/v1/models')
  ?{data:[{id:'Qwen3.8-Flash-Next',owned_by:'tensorfold'}]}
  :{status:'ok',warming:false,max_batch_size:16,live}});
 let s=await p._probeOpenAICompatible();
 assert.equal(s.backend,'tensorfold');assert.equal(s.modelId,'Qwen3.8-Flash-Next');
 assert.equal(s.requestsRunning,3);assert.equal(s.requestsWaiting,2);assert.equal(s.slotsTotal,16);
 assert.equal(s.generationTps,150.5);assert.equal(s.prefillTps,2600);assert.equal(s.totalOutputTokens,null);
 live={...live,connections:0,waiting:0};
 s=await p._probeOpenAICompatible();assert.equal(s.generationTps,0);assert.equal(s.prefillTps,0);
 assert.equal(s.requestsRunning,0);assert.equal(s.kvCacheUsage,null);
});

test('Zig metrics supplement live health with reported counters and draft acceptance',async()=>{
 const p=new LlmProbe({lanIp:'10.77.0.1'},8888);p.serverIsOpenAI=true;
 p._fetch=async url=>({ok:true,status:200,json:async()=>String(url).endsWith('/v1/models')
  ?{data:[{id:'Qwen3.8-Flash-Next',owned_by:'tensorfold'}]}
  :{status:'ok',max_batch_size:16,live:{connections:0,waiting:0}},
  text:async()=> 'tensorfold:generation_tokens_total 125\ntensorfold:mtp_drafted_total 100\ntensorfold:mtp_accepted_total 60\ntensorfold:preemptions_total 0'});
 const s=await p._probeOpenAICompatible();assert.equal(s.totalOutputTokens,125);assert.equal(s.mtpAcceptanceRate,.6);
 assert.equal(s.preemptionsTotal,0);assert.equal(s.prefixCacheHitRate,null);
});

test('new model never retains old context, resets missing metrics and uses native running gauge',async()=>{
 const p=new LlmProbe({lanIp:'10.77.0.1'},8888);p.serverIsOpenAI=true;p.contextLength=1048576;
 let metrics='tensorfold:requests_running 2\ntensorfold:requests_waiting 1\ntensorfold:kv_cache_usage_ratio{pool="0"} 0.25';
 p._fetch=async url=>({ok:true,status:200,json:async()=>String(url).endsWith('/v1/models')?{data:[{id:'Next',owned_by:'tensorfold'}]}:{status:'ok',max_batch_size:16,live:{connections:4,waiting:1,decode_tokens_per_second:100,prefill_tokens_per_second:200}},text:async()=>metrics});
 let s=await p._probeOpenAICompatible();assert.equal(s.contextLength,null);assert.equal(s.kvCacheUsage,.25);assert.equal(s.requestsRunning,2);assert.equal(s.requestsWaiting,1);assert.equal(s.slotsActive,2);
 metrics='';s=await p._probeOpenAICompatible();assert.equal(s.kvCacheUsage,null);assert.equal(s.totalOutputTokens,null);assert.equal(s.requestsRunning,3);
});


test('partial or inconsistent live health never fabricates idle throughput or running zero',async()=>{
 const p=new LlmProbe({lanIp:'10.77.0.1'},8888);p.serverIsOpenAI=true;
 let live={waiting:2};
 p._fetch=async url=>({ok:true,status:200,json:async()=>String(url).endsWith('/v1/models')?{data:[{id:'Next',owned_by:'tensorfold'}]}:{status:'ok',max_batch_size:16,live},text:async()=>''});
 let s=await p._probeOpenAICompatible();assert.equal(s.requestsRunning,null);assert.equal(s.generationTps,null);assert.equal(s.prefillTps,null);
 live={connections:1,waiting:2};s=await p._probeOpenAICompatible();assert.equal(s.requestsRunning,null);assert.equal(s.generationTps,null);
 live={connections:0,waiting:0};s=await p._probeOpenAICompatible();assert.equal(s.requestsRunning,0);assert.equal(s.generationTps,0);
});

test('authenticated Zig minimal health still collects protected native metrics',async()=>{
 const p=new LlmProbe({lanIp:'10.77.0.1'},8888);p.serverIsOpenAI=true;
 p._fetch=async url=>({ok:true,status:200,json:async()=>String(url).endsWith('/v1/models')?{data:[{id:'Qwen3.8-Flash-Next',owned_by:'tensorfold'}]}:{status:'ok'},text:async()=> 'tensorfold:requests_running 3\ntensorfold:requests_waiting 1\ntensorfold:generation_tokens_total 50'});
 const s=await p._probeOpenAICompatible();assert.equal(s.requestsRunning,3);assert.equal(s.requestsWaiting,1);assert.equal(s.totalOutputTokens,50);assert.equal(s.slotsTotal,null);
});


test('minimal health retains a reported capacity but live health without it does not invent one',async()=>{
 const p=new LlmProbe({lanIp:'10.77.0.1'},8888);p.serverIsOpenAI=true;
 let health={status:'ok',max_batch_size:16};
 p._fetch=async url=>({ok:true,status:200,json:async()=>String(url).endsWith('/v1/models')?{data:[{id:'Next',owned_by:'tensorfold'}]}:health,text:async()=>''});
 let s=await p._probeOpenAICompatible();assert.equal(s.slotsTotal,16);
 health={status:'ok',live:{connections:0,waiting:0}};s=await p._probeOpenAICompatible();assert.equal(s.slotsTotal,null);
});


test('switching back to GLM seeds native counters rather than producing cross-model throughput spikes',async()=>{
 const p=new LlmProbe({lanIp:'10.77.0.1'},8888);p.serverIsOpenAI=true;p.modelId='Qwen3.8-Flash-Next';
 p.lastTokenCounts={input:100,output:50};p.lastProbeTime=Date.now()-2000;p.generationTps=123;
 let completion=40000;
 p._fetch=async url=>({ok:true,status:200,json:async()=>String(url).endsWith('/v1/models')?{data:[{id:'GLM-5.3-Flash-EXL3',owned_by:'tensorfold'}]}:{ok:true,backend:'tensorfold',busy:true,requests_running:1,context_length:1048576,streams:{max:4},prompt_tokens_total:1000000,completion_tokens_total:completion},text:async()=>''});
 let s=await p._probeOpenAICompatible();assert.equal(s.modelId,'GLM-5.3-Flash-EXL3');assert.equal(s.contextLength,1048576);assert.equal(s.generationTps,null);assert.equal(s.totalOutputTokens,40000);
 completion+=40;p.lastProbeTime=Date.now()-2000;s=await p._probeOpenAICompatible();assert.ok(s.generationTps>19&&s.generationTps<=20);assert.equal(s.slotsTotal,4);
});

test('hybrid GLM health uses current live rates, eight lanes, model context and native counters',async()=>{
 const p=new LlmProbe({lanIp:'10.77.0.1'},8888);p.serverIsOpenAI=true;
 p._fetch=async url=>({ok:true,status:200,json:async()=>String(url).endsWith('/v1/models')?{data:[{id:'GLM-5.3-Flash-EXL3',owned_by:'tensorfold',max_model_len:1048576}]}:{status:'ok',ok:true,backend:'tensorfold',max_batch_size:8,streams:{max:8},live:{connections:3,waiting:1,decode_tokens_per_second:55,prefill_tokens_per_second:1000},completion_tokens_total:999999},text:async()=> 'tensorfold:requests_running 2\ntensorfold:requests_waiting 1\ntensorfold:generation_tokens_total 3195\ntensorfold:prompt_tokens_total 1000\ntensorfold:prompt_tokens_cached_total 200'});
 const s=await p._probeOpenAICompatible();assert.equal(s.slotsTotal,8);assert.equal(s.contextLength,1048576);assert.equal(s.generationTps,55);assert.equal(s.prefillTps,1000);assert.equal(s.requestsRunning,2);assert.equal(s.totalOutputTokens,3195);assert.equal(s.prefixCacheHitRate,.2);
});

test('optional health failure cannot re-emit stale native telemetry from a healthy models listing',async()=>{
 const p=new LlmProbe({lanIp:'10.77.0.1'},8888);p.serverIsOpenAI=true;
 let healthOk=true;
 p._fetch=async url=>String(url).endsWith('/v1/models')?{ok:true,status:200,json:async()=>({data:[{id:'GLM',owned_by:'tensorfold'}]})}:String(url).endsWith('/health')?{ok:healthOk,status:healthOk?200:503,json:async()=>({status:'ok',max_batch_size:8,live:{connections:1,waiting:0,decode_tokens_per_second:55,prefill_tokens_per_second:200}})}:{ok:true,text:async()=> 'tensorfold:generation_tokens_total 50\ntensorfold:mtp_drafted_total 10\ntensorfold:mtp_accepted_total 6'};
 let s=await p._probeOpenAICompatible();assert.equal(s.generationTps,55);assert.equal(s.mtpAcceptanceRate,.6);
 healthOk=false;s=await p._probeOpenAICompatible();assert.equal(s.available,true);
 for(const key of ['generationTps','prefillTps','requestsRunning','slotsTotal','totalOutputTokens','mtpAcceptanceRate'])assert.equal(s[key],null,key);
});

test('hybrid health context and completion counters survive a missing optional metrics endpoint',async()=>{
 const p=new LlmProbe({lanIp:'10.77.0.1'},8888);p.serverIsOpenAI=true;
 p._fetch=async url=>String(url).endsWith('/v1/models')?{ok:true,status:200,json:async()=>({data:[{id:'GLM',owned_by:'tensorfold'}]})}:String(url).endsWith('/health')?{ok:true,status:200,json:async()=>({status:'ok',context_length:1048576,completion_tokens_total:123,max_batch_size:8,live:{connections:0,waiting:0}})}:{ok:false,status:503};
 let s=await p._probeOpenAICompatible();assert.equal(s.contextLength,1048576);assert.equal(s.totalOutputTokens,123);assert.equal(s.slotsTotal,8);assert.equal(s.generationTps,0);
});
