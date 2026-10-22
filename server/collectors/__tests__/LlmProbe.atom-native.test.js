import test from 'node:test';import assert from 'node:assert/strict';import{LlmProbe}from'../LlmProbe.js';
test('DeepSeek native live interface keeps model identity, live rate and real counters without guessing context',async()=>{
 const p=new LlmProbe({isLocal:true},8888);p.serverIsOpenAI=true;
 p._fetch=async url=>({ok:true,status:200,json:async()=>url.endsWith('/v1/models')?{data:[{id:'DeepSeek-V4.1-Flash-1017',owned_by:'tensorfold'}]}:{status:'ok',model:'DeepSeek-V4.1-Flash-1017',max_batch_size:4,live:{connections:3,waiting:1,decode_tokens_per_second:16.5,prefill_tokens_per_second:1539}},text:async()=> 'tensorfold:requests_running 2\ntensorfold:requests_waiting 0\ntensorfold:prompt_tokens_total 1000\ntensorfold:generation_tokens_total 100\ntensorfold:kv_cache_usage_ratio{pool="0"} 0.25'});
 const s=await p._probeOpenAICompatible();assert.equal(s.backend,'tensorfold');assert.equal(s.modelId,'DeepSeek-V4.1-Flash-1017');assert.equal(s.contextLength,null);assert.equal(s.parallelism,null);assert.equal(s.slotsTotal,4);assert.equal(s.requestsWaiting,1);assert.equal(s.generationTps,16.5);assert.equal(s.prefillTps,1539);assert.equal(s.kvCacheUsage,.25);assert.deepEqual(s.tokenCounters,{prompt:1000,output:100,cached:null,source:'tensorfold:metrics'});
});
test('native optional health failure does not retain old live rates or dereference missing counters',async()=>{
 const p=new LlmProbe({isLocal:true},8888);p.serverIsOpenAI=true;p.generationTps=99;p.contextLength=1048576;
 p._fetch=async url=>url.endsWith('/v1/models')?{ok:true,status:200,json:async()=>({data:[{id:'DeepSeek',owned_by:'tensorfold'}]})}:{ok:false,status:503};
 const s=await p._probeOpenAICompatible();assert.equal(s.available,true);for(const k of ['generationTps','prefillTps','totalOutputTokens','contextLength','slotsTotal'])assert.equal(s[k],null,k);
});
