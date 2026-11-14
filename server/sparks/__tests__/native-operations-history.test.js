import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import{NativeOperationsHistory}from'../../nativeOperationsHistory.js';
const spark=(at,tps)=>({id:'head',name:'ATOM',online:true,role:'head',llmPorts:[8888],telemetry:{updatedAt:{llm:at,gpu:at},successful:{gpu:true}},metrics:{llm:[{backend:'tensorfold',available:true,modelId:'DeepSeek',generationTps:tps,prefillTps:10}],gpu:{usage:1,temperature:40,power:{draw:10}}}});
test('native history preserves unknown gaps, real zeros, worker exclusion and time order',()=>{
 const h=new NativeOperationsHistory();h.record([spark(100000,0)],100000);h.record([spark(105000,null)],105000);h.record([{...spark(110000,500),role:'worker'}],110000);
 assert.deepEqual(h.query('output',30,110000).series[0].points,[[100000,0],[105000,null]]);
 h.record([spark(100000,999)],100000);assert.equal(h.query('output',30,110000).series[0].points.length,2);
 h.record([spark(100000,999)],140000);assert.equal(h.query('output',30,140000).series[0].points.at(-1)[1],null);
});
test('native history survives reload and protects corrupt storage from overwrite',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'atom-history-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'history.json');
 const h=new NativeOperationsHistory(file);h.record([spark(100000,5)],100000);h.flush();assert.equal(new NativeOperationsHistory(file).query('output',30,100000).series[0].points[0][1],5);
 fs.writeFileSync(file,'broken');const broken=new NativeOperationsHistory(file);broken.record([spark(110000,9)],110000);broken.flush();assert.equal(fs.readFileSync(file,'utf8'),'broken');assert.ok(broken.error);
});
test('native history retries transient writes and clears the storage warning after recovery',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'atom-history-retry-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const parent=path.join(dir,'blocked');const file=path.join(parent,'history.json');const h=new NativeOperationsHistory(file);
 fs.writeFileSync(parent,'temporary obstruction');h.record([spark(100000,5)],100000);assert.ok(h.error);
 fs.unlinkSync(parent);h.record([spark(160000,6)],160000);assert.equal(h.error,null);
 assert.deepEqual(new NativeOperationsHistory(file).query('output',30,160000).series[0].points,[[100000,5],[160000,6]]);
});
test('native history updates node labels after a rename without splitting the time series',()=>{
 const h=new NativeOperationsHistory();h.record([spark(100000,5)],100000);
 h.record([{...spark(105000,6),name:'Renamed ATOM'}],105000);
 const rows=h.query('output',30,105000).series;assert.equal(rows.length,1);assert.equal(rows[0].labels.node,'Renamed ATOM');assert.equal(rows[0].points.length,2);
});
