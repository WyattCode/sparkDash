import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeUpgrade, createAuthMiddleware} from '../../auth.js';

test('loopback rejects foreign origins/rebound hosts for HTTP and WebSocket without changing LAN mode', (t) => {
  const keys=['BIND_HOST','SPARKDASH_TOKEN','DASHBOARD_TOKEN','SPARKDASH_ALLOW_OPEN_REMOTE','SPARKDASH_ALLOWED_HOSTS'];
  const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  t.after(()=>{for(const k of keys){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}});
  t.mock.method(console,'warn',()=>{});
  for(const k of keys)delete process.env[k];
  process.env.BIND_HOST='127.0.0.1';
  function request(headers, method='GET') {
    let status=200,accepted=false;
    createAuthMiddleware()({headers,method},{status(s){status=s;return this;},json(){}},()=>{accepted=true;});
    return {status,accepted};
  }
  for(const method of ['GET','POST','PATCH','DELETE']) {
    assert.deepEqual(request({host:'localhost:5555',origin:'http://attacker.invalid'},method),{status:403,accepted:false});
    assert.deepEqual(request({host:'attacker.invalid:5555'},method),{status:403,accepted:false});
    assert.deepEqual(request({host:'localhost:5555',origin:'http://localhost:5555'},method),{status:200,accepted:true});
  }
  assert.equal(authorizeUpgrade({headers:{host:'localhost:5555',origin:'http://attacker.invalid'}}),false);
  process.env.SPARKDASH_ALLOWED_HOSTS='dashboard.example';
  assert.equal(request({host:'dashboard.example',origin:'https://dashboard.example'}).accepted,true);
  process.env.SPARKDASH_TOKEN='test-key';
  assert.equal(request({host:'attacker.invalid',authorization:'Bearer test-key'},'POST').accepted,true);
  delete process.env.SPARKDASH_TOKEN;
  process.env.BIND_HOST='0.0.0.0';
  assert.equal(request({host:'192.168.1.2:5555',origin:'http://192.168.1.2:5555'},'POST').accepted,true);
});
