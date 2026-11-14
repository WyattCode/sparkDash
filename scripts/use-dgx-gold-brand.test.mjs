import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
test('gold branding is opt-in, handles inline SVG attributes, and is idempotent',()=>{
 const dir=mkdtempSync(join(tmpdir(),'sparkdash-brand-test-'));
 try{
  mkdirSync(join(dir,'scripts'));copyFileSync(new URL('./use-dgx-gold-brand.mjs',import.meta.url),join(dir,'scripts','brand.mjs'));copyFileSync(new URL('../index.html',import.meta.url),join(dir,'index.html'));
  const original=readFileSync(join(dir,'index.html'),'utf8'),script=join(dir,'scripts','brand.mjs');
  assert.equal(spawnSync(process.execPath,[script]).status,0);assert.equal(readFileSync(join(dir,'index.html'),'utf8'),original);
  assert.equal(spawnSync(process.execPath,[script,'--apply']).status,0);
  const changed=readFileSync(join(dir,'index.html'),'utf8');assert.match(changed,/href="\/dgx-gold\/favicon\.svg/);assert.ok(!changed.includes('data:image/svg+xml'));assert.ok(!changed.includes('</svg>'));assert.ok(changed.includes('syncViewport()'));
  assert.equal(spawnSync(process.execPath,[script,'--apply']).status,0);assert.equal(readFileSync(join(dir,'index.html'),'utf8'),changed);
 }finally{rmSync(dir,{recursive:true});}
});
