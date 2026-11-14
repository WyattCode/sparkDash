import test from 'node:test';
import assert from 'node:assert/strict';
import {registerRoceRoutes} from '../../roceRoutes.js';
import {FAST,SLOW} from '../../collectors/__tests__/roce.fixtures.js';

function setup(run){
  let changed;const routes=new Map();
  const registry={getSpark:id=>id==='fixture'?{id,isLocal:true,ssh:{password:'never-return-this'}}:null,onChange:fn=>{changed=fn;}};
  registerRoceRoutes({get:(p,h)=>routes.set(p,h)},registry,{run,now:()=>1000000});
  return {changed:(...args)=>changed(...args),request:async(id='fixture')=>{
    let status=200,body;await routes.values().next().value({params:{id}},{status(n){status=n;return this;},json(v){body=v;}});
    return {status,body};
  }};
}
test('RoCE is lazy, bounded, read-only and shared across concurrent requests',async()=>{
  let reads=0;const ctx=setup(async(_spark,script)=>{reads++;return script.includes('mlnx_qos')?SLOW:FAST;});
  assert.equal(reads,0);assert.equal((await ctx.request('absent')).status,404);assert.equal(reads,0);
  const [a,b]=await Promise.all([ctx.request(),ctx.request()]);assert.equal(reads,2);
  assert.equal(a.body.available,true);assert.equal(a.body.stale,false);assert.equal(b.body.devices.length,2);
  assert.ok(!JSON.stringify(a.body).includes('never-return-this'));
  await ctx.request();assert.equal(reads,2);
  ctx.changed();await ctx.request();assert.equal(reads,4);
});
test('unknown data stays unavailable and sampling errors do not expose raw SSH details',async()=>{
  assert.equal((await setup(async()=>'').request()).body.available,false);
  const ctx=setup(async()=>{throw new Error('private credentials');});
  for(let i=0;i<4;i++){
    const result=await ctx.request();assert.equal(result.status,503);assert.ok(!JSON.stringify(result).includes('private credentials'));
  }
});

test('node configuration changes during a read reject the obsolete result',async()=>{
  let release;let reads=0;
  const ctx=setup(async(_spark,script)=>{
    reads++;
    if(!script.includes('mlnx_qos'))return new Promise(resolve=>{release=()=>resolve(FAST);});
    return SLOW;
  });
  const pending=ctx.request();ctx.changed();release();
  const result=await pending;assert.equal(result.status,409);assert.equal(reads,1);
  assert.equal(result.body.devices,undefined);
});

test('reordering and changes to another node keep the current sampling baseline',async()=>{
  let reads=0;const ctx=setup(async(_spark,script)=>{reads++;return script.includes('mlnx_qos')?SLOW:FAST;});
  await ctx.request();assert.equal(reads,2);
  ctx.changed('reorder',null);await ctx.request();assert.equal(reads,2);
  ctx.changed('update',{id:'different-node'});await ctx.request();assert.equal(reads,2);
  ctx.changed('update',{id:'fixture'});await ctx.request();assert.equal(reads,4);
});
