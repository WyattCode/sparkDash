import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createServiceVerification,recordCurrent,registerVerificationRoutes} from '../../serviceVerification.js';
const MODEL='deepseek-v4-flash-vision-exp',BOOT='2025-01-01T00:00:00.000Z';
function fixture(overrides={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'verify-test-'));
  const file=path.join(dir,'records.json');fs.writeFileSync(file,'{}');
  const imageFile=path.join(dir,'test.jpg');fs.writeFileSync(imageFile,'fixture');
  const calls=[];
  const response=(status,data)=>({status,ok:status===200,json:async()=>data,body:{cancel:async()=>{}}});
  const fetchImpl=async(url,opts={})=>{
    calls.push({url:String(url),opts});
    if(String(url).includes(':9090')) {
      const q=new URL(url).searchParams.get('query');
      return response(200,{status:'success',data:{result:[{metric:{instance:'head:8888'},value:[Date.now()/1000,q.startsWith('timestamp(')?String(Date.now()/1000):q.startsWith('up{')?'1':'0']}]}});
    }
    if(opts.method==='POST')return response(200,{choices:[{finish_reason:'stop',message:{content:JSON.parse(opts.body).messages[0].content instanceof Array?'red':'SPARK_OK'}}]});
    return opts.headers?.Authorization==='Bearer SECRET'?response(200,{data:[{id:MODEL}]}):response(401,{});
  };
  const service=createServiceVerification({file,imageFile,nodeName:'fixture-head',getBoot:async()=>BOOT,snapshots:()=>[{id:'head',name:'fixture-head',isLocal:true,role:'head',llmPort:8888,metrics:{llm:[{modelId:MODEL}]}}],getSpark:()=>({llmApiKeys:{8888:'SECRET'}}),fetchImpl,...overrides});
  return {service,file,calls,fetchImpl,cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
test('records require matching model and boot; missing boot never passes',()=>{
  assert.equal(recordCurrent({model:MODEL,boot:BOOT},BOOT,MODEL),true);
  assert.equal(recordCurrent({model:MODEL,boot:BOOT},null,MODEL),false);
  assert.equal(recordCurrent({model:'other',boot:BOOT},BOOT,MODEL),false);
  assert.equal(recordCurrent({model:MODEL,boot:'old'},BOOT,MODEL),false);
});
test('GET independently verifies valid, missing and wrong keys; no inference or secrets in result',async()=>{
  const f=fixture();try{const s=await f.service.status();assert.equal(s.auth.status,'verified');assert.equal(f.calls.length,3);assert.ok(f.calls.every(c=>c.opts.method==='GET'));assert.ok(!JSON.stringify(s).includes('SECRET'));await f.service.status();assert.equal(f.calls.length,3);}finally{f.cleanup();}
});
test('manual verification persists bounded text and image results, then rate limits',async()=>{
  const f=fixture();try{
    const result=await f.service.verify();assert.equal(result.inference.status,'passed');assert.equal(result.vision.status,'passed');
    const posts=f.calls.filter(c=>c.opts.method==='POST');assert.equal(posts.length,2);
    assert.ok(posts.every(c=>JSON.parse(c.opts.body).max_tokens===32));
    assert.equal(JSON.parse(fs.readFileSync(f.file)).vision.boot,BOOT);
    await assert.rejects(f.service.verify(),e=>e.status===429);
  }finally{f.cleanup();}
});
test('busy or missing queue series refuses all inference',async()=>{
  const f=fixture();const g=fixture({fetchImpl:async(url,opts)=>String(url).includes(':9090')?{ok:true,json:async()=>({status:'success',data:{result:[]}})}:f.fetchImpl(url,opts)});
  try{await assert.rejects(g.service.verify(),e=>e.status===409);assert.equal(f.calls.filter(c=>c.opts.method==='POST').length,0);}finally{f.cleanup();g.cleanup();}
});
test('rejected key and corrupt evidence never trigger generation',async()=>{
  const f=fixture({getSpark:()=>({llmApiKeys:{8888:'BAD'}})});
  try{assert.equal((await f.service.status()).auth.status,'rejected');await assert.rejects(f.service.verify(),e=>e.status===409);}finally{f.cleanup();}
  const g=fixture();try{fs.writeFileSync(g.file,'invalid');await assert.rejects(g.service.verify(),e=>e.status===503);assert.equal(fs.readFileSync(g.file,'utf8'),'invalid');}finally{g.cleanup();}
});
test('failed text check does not run image test or invent a pass',async()=>{
  const f=fixture();const g=fixture({fetchImpl:async(url,opts)=>opts?.method==='POST'?{ok:true,status:200,json:async()=>({choices:[{finish_reason:'length',message:{content:'SPARK_OK'}}]})}:f.fetchImpl(url,opts)});
  try{const s=await g.service.verify();assert.equal(s.inference.status,'failed');assert.equal(s.vision,null);}finally{f.cleanup();g.cleanup();}
});
test('POST requires explicit confirmation',async()=>{
  const routes={};registerVerificationRoutes({get(){},post(p,h){routes[p]=h;}},{snapshots:()=>[],getSpark:()=>null,file:'/missing'});
  let status;await routes['/api/operations/verification']({body:{}},{status(s){status=s;return this;},json(){}});assert.equal(status,400);
});
test('unconfigured or ambiguous node does not issue probes',async()=>{
  const node={id:'head',name:'fixture-head',isLocal:true,role:'head',llmPort:8888,metrics:{llm:[{modelId:MODEL}]}};
  for(const overrides of [{nodeName:''},{snapshots:()=>[node,{...node,id:'other'}]}]) {
    const f=fixture(overrides);
    try {assert.equal((await f.service.status()).supported,false);await assert.rejects(f.service.verify(),e=>e.status===409);assert.equal(f.calls.length,0);}finally{f.cleanup();}
  }
});
test('configured node labels are escaped in every Prometheus selector',async()=>{
  const nodeName='test"node\\name';
  const f=fixture({nodeName,snapshots:()=>[{id:'head',name:nodeName,isLocal:true,role:'head',llmPort:8888,metrics:{llm:[{modelId:MODEL}]}}]});
  try {
    await f.service.verify();
    const queries=f.calls.filter(c=>c.url.includes(':9090')).map(c=>new URL(c.url).searchParams.get('query'));
    assert.ok(queries.length>0);assert.ok(queries.every(q=>q.includes(`node=${JSON.stringify(nodeName)}`)));
  }finally{f.cleanup();}
});
test('missing image path refuses generation',async()=>{
  const f=fixture({imageFile:''});
  try {await assert.rejects(f.service.verify());assert.equal(f.calls.filter(c=>c.opts.method==='POST').length,0);}finally{f.cleanup();}
});
for (const scenario of ['stale','down','busy','different-instance','missing','invalid']) {
  test(`verification refuses ${scenario} telemetry without generation`,async()=>{
    const f=fixture();
    const g=fixture({fetchImpl:async(url,opts)=>{
      if(!String(url).includes(':9090'))return f.fetchImpl(url,opts);
      const q=new URL(url).searchParams.get('query');
      const row={metric:{instance:scenario==='different-instance'&&q.includes('waiting')?'other:8888':'head:8888'},value:[Date.now()/1000,q.startsWith('timestamp(')?String(Date.now()/1000-(scenario==='stale'?120:0)):q.startsWith('up{')?(scenario==='down'?'0':'1'):(scenario==='busy'?'2':'0')]};
      if(scenario==='invalid')row.value[1]='NaN';
      return {ok:true,json:async()=>({status:'success',data:{result:scenario==='missing'?[]:[row]}})};
    }});
    try {await assert.rejects(g.service.verify(),e=>e.status===409);assert.equal(f.calls.filter(c=>c.opts.method==='POST').length,0);}finally{f.cleanup();g.cleanup();}
  });
}
