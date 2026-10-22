import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sparkdash-secret-integrity-'));
process.env.SPARKS_SECRETS_PATH=path.join(dir,'secrets.json');
process.env.SECRETS_KEY_PATH=path.join(dir,'key');
const {saveSecrets,loadSecrets}=await import('../../secretsStore.js');
test.after(()=>fs.rmSync(dir,{recursive:true,force:true}));

test('malformed secrets are neither overwritten nor deleted',()=>{
  for(const text of ['broken-json','null','[]','{"secrets":[]}','{"llmApiKeys":"invalid"}','{"secrets":{"fixture":42}}','{"version":99}']){
    for(const passwords of [new Map(),new Map([['fixture','test-password']])]){
      fs.writeFileSync(process.env.SPARKS_SECRETS_PATH,text);
      assert.throws(()=>saveSecrets(passwords),/禁止覆盖/);
      assert.equal(fs.readFileSync(process.env.SPARKS_SECRETS_PATH,'utf8'),text);
      assert.equal(fs.existsSync(process.env.SECRETS_KEY_PATH),false);
    }
  }
});
test('unknown encrypted sections survive normal writes and clearing known sections',()=>{
  fs.writeFileSync(process.env.SPARKS_SECRETS_PATH,JSON.stringify({version:2,secrets:{},llmApiKeys:{},other:{fixture:'opaque'}}));
  process.env.SPARKDASH_SECRETS_KEY='fixture-only-key';
  saveSecrets(new Map([['fixture','test-password']]));
  assert.equal(loadSecrets().passwords.get('fixture'),'test-password');
  saveSecrets(new Map());
  const result=JSON.parse(fs.readFileSync(process.env.SPARKS_SECRETS_PATH));
  assert.deepEqual(result.other,{fixture:'opaque'});assert.deepEqual(result.secrets,{});
});

test('valid JSON with undecryptable credential entries cannot be overwritten or cleared',()=>{
  for(const section of ['secrets','llmApiKeys']){
    fs.writeFileSync(process.env.SPARKS_SECRETS_PATH,JSON.stringify({version:2,secrets:{},llmApiKeys:{}}));
    saveSecrets(new Map([['fixture','fixture-password']]),new Map([['fixture',{'8888':'fixture-key'}]]));
    const data=JSON.parse(fs.readFileSync(process.env.SPARKS_SECRETS_PATH));
    data[section].fixture='broken-cipher';const original=JSON.stringify(data);
    fs.writeFileSync(process.env.SPARKS_SECRETS_PATH,original);
    for(const passwords of [new Map(),new Map([['fixture','replacement']])]){
      assert.throws(()=>saveSecrets(passwords),/禁止覆盖/);
      assert.equal(fs.readFileSync(process.env.SPARKS_SECRETS_PATH,'utf8'),original);
    }
  }
});
