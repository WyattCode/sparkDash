import { describe, expect, it } from 'vitest';
import { makeSpark } from '../../testing/fixtures';
import { completeSum, finite, gpuReady, metricValue, nodeIssues, percent, sampleHint, type Operations } from './operationsModel';
describe('operations metric semantics',()=>{
  it('requires complete coverage for totals but preserves true zero',()=>{
    const series=(v:number|null)=>({labels:{},points:[[1,v] as [number,number|null]]});
    expect(completeSum([])).toBeNull();expect(completeSum([series(null)])).toBeNull();
    expect(completeSum([series(2),series(null)])).toBeNull();expect(completeSum([series(0)])).toBe(0);
    expect(completeSum([series(2),series(3)])).toBe(5);
  });
  it('preserves zero but rejects missing and non-finite values',()=>{
    expect(finite(0)).toBe(0);expect(finite(null)).toBeNull();expect(finite(NaN)).toBeNull();
    expect(percent(0,10)).toBe('0.0%');expect(percent(0,0)).toBe('暂无请求');
    expect(sampleHint(0)).toBe('窗口内暂无样本');
  });
  it('does not count worker absence of API as failure or high GPU usage as an alarm',()=>{
    const s=makeSpark();s.role='worker';s.metrics.llm=[];s.metrics.gpu!.usage=99;
    s.telemetry={updatedAt:{gpu:Date.now()},successful:{gpu:true}};
    expect(nodeIssues(s)).toEqual([]);expect(gpuReady(s)).toBe(true);
    s.telemetry.updatedAt.gpu-=60000;expect(gpuReady(s)).toBe(false);
  });
  it('does not combine independent instances or average P95 values',()=>{
    const data={metrics:{ttft:{series:[{labels:{node:'head',instance:'a'},points:[[1,2]]},{labels:{node:'head',instance:'b'},points:[[1,8]]}]}}} as unknown as Operations;
    expect(metricValue(data,'ttft','head')).toBeNull();
    expect(metricValue(data,'ttft','head','a')).toBe(2);
  });
});
