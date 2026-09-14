import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeSeries, registerOperationsRoutes, QUERIES } from '../../operations.js';

test('NaN and infinity stay missing; genuine zero remains zero', () => {
  const rows=normalizeSeries([{metric:{node:'test'},values:[[1,'0'],[2,'NaN'],[3,'+Inf'],[4,'4.2']]}]);
  assert.deepEqual(rows[0].points,[[1000,0],[2000,null],[3000,null],[4000,4.2]]);
});
test('percentiles aggregate buckets by service and retain time window', () => {
  assert.match(QUERIES.ttft,/histogram_quantile\(0.95/);
  assert.match(QUERIES.ttft,/node,instance,model_name,le/);
  assert.match(QUERIES.ttft,/rate\(.*\[30m\]/);
  assert.match(QUERIES.httpTotal,/method="POST"/);
  assert.match(QUERIES.httpTotal,/completions/);
});
test('history endpoint rejects unbounded client queries before fetching', async () => {
  const routes=new Map();registerOperationsRoutes({get:(path,handler)=>routes.set(path,handler)});
  let status=200;
  const res={status(n){status=n;return this;},json(value){return value;}};
  await routes.get('/api/operations/history')({query:{metric:'up',minutes:30}},res);
  assert.equal(status,400);
  status=200;
  await routes.get('/api/operations/history')({query:{metric:'output',minutes:100000}},res);
  assert.equal(status,400);
});
test('event records survive handler recreation without changing model services', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sparkdash-events-test-'));
  const file=path.join(dir,'events.json');
  const original=globalThis.fetch;
  globalThis.fetch=async url=>({ok:true,json:async()=>({status:'success',data:String(url).includes('/targets')?{activeTargets:[{labels:{node:'head',job:'dcgm',instance:'fixture'},health:'up',lastScrape:new Date().toISOString()}]}:{result:[]}})});
  try {
    const handlers=new Map();
    registerOperationsRoutes({get:(p,h)=>handlers.set(p,h)},()=>[],file);
    let body;
    await handlers.get('/api/operations')({}, {json:d=>{body=d;}});
    assert.equal(body.eventStorageError,null);
    assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).events.length,1);
    const again=new Map();registerOperationsRoutes({get:(p,h)=>again.set(p,h)},()=>[],file);
    await again.get('/api/operations')({}, {json:d=>{body=d;}});
    assert.ok(body.events.length>=2);
    assert.equal(body.events.at(-1).message,'dcgm：首次观察 → 抓取正常');
  } finally {globalThis.fetch=original;fs.rmSync(dir,{recursive:true,force:true});}
});
