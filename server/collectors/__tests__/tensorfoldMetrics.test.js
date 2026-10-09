import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTensorfoldMetrics} from '../tensorfoldMetrics.js';
import {LlmProbe} from '../LlmProbe.js';
import {registerOperationsRoutes} from '../../operations.js';
import {createServiceVerification} from '../../serviceVerification.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const metrics=`tensorfold:requests_running 3
 tensorfold:requests_waiting 2
 tensorfold:prompt_tokens_total 1000
 tensorfold_health:cached_tokens_total 800
 tensorfold:time_to_first_token_seconds_bucket{le="1"} 5
 tensorfold:time_to_first_token_seconds_bucket{le="2"} 10
 tensorfold:time_to_first_token_seconds_bucket{le="+Inf"} 10
 tensorfold:time_to_first_token_seconds_count 10
 tensorfold:request_latency_seconds_bucket{le="1"} 5
 tensorfold:request_latency_seconds_bucket{le="2"} 10
 tensorfold:request_latency_seconds_bucket{le="+Inf"} 10
 tensorfold:request_latency_seconds_count 10`.replace(/^ /gm,'');
test('TensorFold native gauges, histogram samples and token cache ratio remain distinct from unsupported metrics',()=>{
 const m=parseTensorfoldMetrics(metrics);
 assert.equal(m.running,3);assert.equal(m.waiting,2);assert.equal(m.ttft,1.9);assert.equal(m.ttftSamples,10);assert.equal(m.e2e,1.9);assert.equal(m.cache,.8);
 for(const key of ['itl','itlSamples','queue','httpTotal','httpOk'])assert.equal(m[key],null);
});
test('malformed histograms and missing counters never invent zero, latency, or cache hits',()=>{
 const m=parseTensorfoldMetrics(metrics.replace('le="+Inf"} 10','le="+Inf"} 9'));
 assert.equal(m.ttft,null);assert.equal(m.ttftSamples,null);
 const absent=parseTensorfoldMetrics('tensorfold:requests_running NaN');assert.equal(absent.running,null);assert.equal(absent.cache,null);
 assert.equal(parseTensorfoldMetrics(metrics.replace('cached_tokens_total 800','cached_tokens_total 1001')).cache,null);
 assert.equal(parseTensorfoldMetrics(metrics.replace('le="1"} 5','le="1"} 11')).ttft,null);
});
test('TensorFold health keeps actual multi-lane concurrency instead of collapsing busy to one request',()=>{
 const p=new LlmProbe({isLocal:true,llmPort:8888});
 p._applyExl3Health({busy:true,requests_running:3,streams:{max:4},context_length:1000,completion_tokens_total:12,prompt_tokens_total:20},2);
 assert.equal(p.requestsRunning,3);assert.equal(p.slotsActive,3);assert.equal(p.slotsTotal,4);
});
test('operations uses local TensorFold native metrics without a Prometheus dependency or leaking keys',async()=>{
 const original=globalThis.fetch;const calls=[];const routes=new Map();
 globalThis.fetch=async(url,opts)=>{calls.push({url,opts});return {ok:true,text:async()=>metrics};};
 try {
  registerOperationsRoutes({get:(p,h)=>routes.set(p,h)},()=>[{id:'head',name:'ATOM',isLocal:true,role:'head',online:true,llmMonitoring:true,llmPorts:[8888],metrics:{llm:[{available:true,backend:'tensorfold',modelId:'GLM'}]}}],null,()=>({llmApiKeys:{8888:'SECRET'}}));
  let data;await routes.get('/api/operations')({}, {json:x=>data=x});
  assert.equal(calls.length,1);assert.equal(calls[0].url,'http://127.0.0.1:8888/metrics');assert.equal(calls[0].opts.headers.Authorization,'Bearer SECRET');
  assert.equal(data.metrics.running.series[0].points[0][1],3);assert.equal(data.targets[0].labels.source,'native');assert.equal(data.targets[0].health,'up');
  assert.ok(!JSON.stringify(data).includes('SECRET'));
 } finally {globalThis.fetch=original;}
});
test('TensorFold auth status matches current configured Head and does not require fixed DeepSeek model or label',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tensorfold-auth-'));const calls=[];
 try {
  const service=createServiceVerification({file:path.join(dir,'records.json'),getSpark:()=>({}),getBoot:async()=>null,nodeName:'',snapshots:()=>[{id:'head',name:'AI TOP ATOM',isLocal:true,role:'head',llmPorts:[8888],metrics:{llm:[{modelId:'GLM',backend:'tensorfold'}]}}],fetchImpl:async(url,opts)=>{calls.push(opts);return {ok:true,status:200,json:async()=>({data:[{id:'GLM'}]})};}});
  const state=await service.status();assert.equal(state.supported,true);assert.equal(state.auth.status,'open');assert.equal(state.node,'AI TOP ATOM');assert.equal(state.canVerify,false);
  assert.equal(state.inference,null);assert.equal(state.vision,null);assert.ok(calls.every(x=>x.method==='GET'));
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('TensorFold identification uses owned_by directly and never sums independent KV pool ratios',async()=>{
 const p=new LlmProbe({isLocal:true,llmPort:8888});
 p._fetch=()=>{throw new Error('Detection should not require extra HTTP');};
 assert.equal(await p._classifyOpenAIBackend('tensorfold'),'tensorfold');
 assert.equal(parseTensorfoldMetrics('tensorfold:kv_cache_usage_ratio{pool="0"} 0.6\ntensorfold:kv_cache_usage_ratio{pool="1"} 0.7').kv,null);
});
test('an unavailable TensorFold stays native and exposes a failed target instead of requiring exporters',async()=>{
 const original=globalThis.fetch;globalThis.fetch=()=>{throw new Error('No exporter or inference requests expected');};
 try {
  const routes=new Map();
  registerOperationsRoutes({get:(p,h)=>routes.set(p,h)},()=>[{id:'head',name:'ATOM',isLocal:true,role:'head',online:true,llmMonitoring:true,llmPorts:[8888],metrics:{llm:[{available:false,backend:'tensorfold',modelId:null}]}}]);
  let data;await routes.get('/api/operations')({}, {json:x=>data=x});
  assert.deepEqual(data.expectedTargets,[]);assert.equal(data.targets[0].health,'down');assert.equal(data.targetError,null);assert.equal(data.metrics.running.series.length,0);
 } finally {globalThis.fetch=original;}
});
test('a mixed TensorFold and vLLM deployment retains the Prometheus collection path',async()=>{
 const original=globalThis.fetch;const calls=[];
 globalThis.fetch=async url=>{calls.push(String(url));return String(url).includes(':8888')?{ok:true,text:async()=>metrics}:{ok:true,json:async()=>({status:'success',data:{result:[],activeTargets:[]}})};};
 try {
  const routes=new Map();
  registerOperationsRoutes({get:(p,h)=>routes.set(p,h)},()=>[{id:'head',name:'ATOM',isLocal:true,role:'head',online:true,llmMonitoring:true,llmPorts:[8888,8889],metrics:{llm:[{available:true,backend:'tensorfold',modelId:'GLM'},{available:true,backend:'vllm',modelId:'other'}]}}]);
  let data;await routes.get('/api/operations')({}, {json:x=>data=x});
  assert.ok(calls.some(url=>url.includes(':9090')));assert.equal(data.expectedTargets,null);assert.equal(data.metrics.running.series[0].points[0][1],3);
 } finally {globalThis.fetch=original;}
});

test('native pool utilization and draft acceptance validate denominators and preserve true zero',()=>{
 const parse=(total,free,drafted,accepted)=>parseTensorfoldMetrics(`tensorfold_health:pool_tokens ${total}\ntensorfold_health:pool_free_tokens ${free}\ntensorfold:mtp_drafted_total ${drafted}\ntensorfold:mtp_accepted_total ${accepted}`);
 const m=parse(100,25,20,12);assert.equal(m.poolUsage,.75);assert.equal(m.poolUsed,75);assert.equal(m.mtp,.6);
 assert.equal(parse(100,100,20,0).poolUsage,0);assert.equal(parse(100,100,20,0).mtp,0);
 for(const m of [parse(0,0,0,0),parse(100,101,20,21),parse(100,'NaN',20,'NaN'),parseTensorfoldMetrics('')]){assert.equal(m.poolUsage,null);assert.equal(m.mtp,null);}
});
