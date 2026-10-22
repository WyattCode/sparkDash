import { registerControlAdmission } from './controlAdmission.js';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'control-admission-'));const file=path.join(dir,'lock.json');
try{
 const handlers={};let middleware,busy=false;
 const app={get:(p,f)=>handlers['GET '+p]=f,post:(p,f)=>handlers['POST '+p]=f,use:f=>middleware=f};
 registerControlAdmission(app,{file,readSecret:()=> 'test-secret',activeJobs:()=>busy});
 const request=(body={},headers={})=>({body,get:k=>headers[k],method:'POST',path:'/api/sparks/head/llm/showcase'});
 const response=()=>({code:200,listeners:{},status(n){this.code=n;return this},json(d){this.body=d;return this},once(k,fn){this.listeners[k]=fn}});
 const token='a'.repeat(32),header={'X-DGX-Control':'test-secret'};
 let r=response();handlers['POST /api/control-operation'](request({action:'reserve',token}),r);assert.equal(r.code,403);
 r=response();handlers['POST /api/control-operation'](request({action:'reserve',token},header),r);assert.equal(r.code,200);
 let next=0;r=response();middleware(request(),r,()=>next++);assert.equal(r.code,409);assert.equal(next,0);
 r=response();middleware(request({}, {...header,'X-DGX-Operation':token}),r,()=>next++);assert.equal(next,1);r.listeners.finish();
 r=response();handlers['POST /api/control-operation'](request({action:'release',token:'b'.repeat(32)},header),r);assert.equal(r.code,409);
 r=response();handlers['POST /api/control-operation'](request({action:'release',token},header),r);assert.equal(r.code,200);
 const native=response();middleware(request(),native,()=>next++);assert.equal(next,2);
 r=response();handlers['POST /api/control-operation'](request({action:'reserve',token},header),r);assert.equal(r.code,409);native.listeners.finish();
 busy=true;r=response();handlers['POST /api/control-operation'](request({action:'reserve',token},header),r);assert.equal(r.code,409);busy=false;
 r=response();handlers['POST /api/control-operation'](request({action:'reserve',token},header),r);assert.equal(r.code,200);
 // Re-registering simulates a panel restart; a reservation must survive.
 registerControlAdmission(app,{file,readSecret:()=> 'test-secret',activeJobs:()=>false});
 r=response();middleware(request(),r,()=>next++);assert.equal(r.code,409);assert.equal(next,2);
 fs.writeFileSync(file,'corrupt');r=response();middleware(request(),r,()=>next++);assert.equal(r.code,503);
 console.log('PASS: authorization, ownership, native/reserved race, active jobs, persistent lock, fail-closed corruption');
}finally{fs.rmSync(dir,{recursive:true,force:true})}
