import {expect,it} from 'vitest';
import {makeSpark} from '../testing/fixtures';
import {validSnapshots} from './snapshotValidation';

for (const key of ['generationTps','prefillTps'] as const) {
  it.each([null,undefined,'12',NaN,Infinity,-Infinity,-1])(`rejects invalid ${key}: %s`,value=>{
    const spark=makeSpark();
    Object.assign(spark.metrics.llm[0],{[key]:value});
    expect(validSnapshots([spark])).toBe(false);
  });
  it.each([0,0.25,120])(`accepts valid ${key}: %s`,value=>{
    const spark=makeSpark();spark.metrics.llm[0][key]=value;
    expect(validSnapshots([spark])).toBe(true);
  });
}
it('allows unavailable services with no throughput, and workers with no local API',()=>{
  const spark=makeSpark();
  Object.assign(spark.metrics.llm[0],{available:false,generationTps:null,prefillTps:undefined});
  expect(validSnapshots([spark])).toBe(true);
  spark.metrics.llm=[];
  expect(validSnapshots([spark])).toBe(true);
});
