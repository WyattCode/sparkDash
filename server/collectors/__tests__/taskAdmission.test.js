import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertBenchmarkAdmission} from '../../taskAdmission.js';
const idle=()=>({getActive:()=>null,activeCount:()=>0});
test('rechecks each task kind after asynchronous target resolution', async()=>{
  for(const kind of ['decode','prefill','showcase']) {
    const managers={decode:idle(),prefill:idle(),showcase:idle()};
    assertBenchmarkAdmission('test','decode',managers);
    await Promise.resolve();
    managers[kind].getActive=()=>({status:'running'});
    assert.throws(()=>assertBenchmarkAdmission('test','decode',managers),{status:409});
  }
});
test('rechecks global capacity at admission',()=>{
  const managers={decode:idle(),prefill:idle(),showcase:idle()};
  managers.prefill.activeCount=()=>2;
  assert.throws(()=>assertBenchmarkAdmission('test','decode',managers),{status:429});
});
