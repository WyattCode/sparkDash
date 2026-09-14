import test from 'node:test';
import assert from 'node:assert/strict';
import {authMode,authorizeUpgrade,createAuthMiddleware} from '../../auth.js';
import {evaluateStartupPreflight} from '../../startupPreflight.js';
import {evaluateHealth} from '../../health.js';
const keys=['BIND_HOST','SPARKDASH_TOKEN','DASHBOARD_TOKEN','SPARKDASH_ALLOW_OPEN_REMOTE'];
for(const [host,token,open,mode] of [
  ['127.0.0.1','',false,'loopback-open'],
  ['0.0.0.0','',true,'remote-open'],
  ['0.0.0.0','',false,'required-missing'],
  ['0.0.0.0','test-key',false,'bearer'],
  ['127.0.0.1','test-key',false,'bearer'],
])test(`consistent health, preflight, HTTP and WS: ${host} ${mode}`,()=>{
  const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  try {
    process.env.BIND_HOST=host;process.env.SPARKDASH_TOKEN=token;delete process.env.DASHBOARD_TOKEN;process.env.SPARKDASH_ALLOW_OPEN_REMOTE=open?'1':'0';
    assert.equal(authMode(host),mode);
    assert.equal(evaluateHealth({bindHost:host,configWritable:true,secretsKeyPresent:true,sshIdentityPresent:true}).authMode,mode);
    assert.equal(evaluateStartupPreflight({bindHost:host,tokenConfigured:!!token,allowOpenRemote:open,configWritable:true}).authMode,mode);
    for(const method of ['GET','POST','PUT','PATCH','DELETE']) {
      let accepted=false,status;
      createAuthMiddleware()({method,headers:{},query:{}},{status(code){status=code;return this;},json(){}},()=>{accepted=true;});
      const localRead=host==='127.0.0.1'&&method==='GET';
      assert.equal(accepted,localRead||mode==='remote-open'||mode==='loopback-open',method);
      if(!accepted)assert.equal(status,token?401:403);
    }
    assert.equal(authorizeUpgrade({headers:{},query:{}}),!token&&mode!=='required-missing');
    if(token)assert.equal(authorizeUpgrade({headers:{authorization:`Bearer ${token}`},query:{}}),true);
  } finally {for(const k of keys){if(old[k]==null)delete process.env[k];else process.env[k]=old[k];}}
});
