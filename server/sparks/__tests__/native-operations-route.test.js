import test from 'node:test';import assert from 'node:assert/strict';import{registerOperationsRoutes}from'../../operations.js';
test('native local operations avoids foreign exporters and Prometheus while redacting the configured key',async()=>{
 const original=globalThis.fetch;const calls=[];const routes=new Map();
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return{ok:true,text:async()=> 'tensorfold:requests_running 0\ntensorfold:requests_waiting 0\ntensorfold:generation_tokens_total 10'};};
 try{
  registerOperationsRoutes({get:(p,h)=>routes.set(p,h)},()=>[{id:'head',name:'ATOM',isLocal:true,role:'head',online:true,llmMonitoring:true,llmPorts:[8888],metrics:{llm:[{available:true,backend:'tensorfold',modelId:'DeepSeek'}]}}],null,()=>({llmApiKeys:{8888:'PRIVATE-KEY-FIXTURE'}}));
  let body;await routes.get('/api/operations')({}, {json:x=>body=x});
  assert.equal(calls.length,1);assert.equal(calls[0].url,'http://127.0.0.1:8888/metrics');assert.equal(calls[0].options.headers.Authorization,'Bearer PRIVATE-KEY-FIXTURE');
  assert.deepEqual(body.expectedTargets,[]);assert.equal(body.aggregation,'lifetime');assert.equal(body.targets[0].health,'up');assert.equal(body.metrics.running.series[0].points[0][1],0);assert.ok(!JSON.stringify(body).includes('PRIVATE-KEY-FIXTURE'));assert.ok(!JSON.stringify(body).includes('spark-b5e5'));
 }finally{globalThis.fetch=original;}
});
