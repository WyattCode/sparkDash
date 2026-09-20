import {expect,it} from 'vitest';
import {formatCount,formatEstimatedCount} from './metricCounts';
import {sampleHint} from './components/OverviewPage/operationsModel';
it.each([[0,'0'],[1,'1'],[42,'42'],[null,'未采集'],[undefined,'未采集'],
  [1.5,'数据异常'],[-1,'数据异常'],[NaN,'数据异常'],[Infinity,'数据异常']])('exact count %s -> %s',(v,result)=>{
  expect(formatCount(v as number|null|undefined)).toBe(result);
});
it.each([[0,'0 次'],[0.25,'不足 1 次（估算）'],[1.25,'约 1 次'],[12.8,'约 13 次'],
  [null,'未采集'],[-1,'数据异常'],[NaN,'数据异常']])('estimated count %s -> %s',(v,result)=>{
  expect(formatEstimatedCount(v as number|null)).toBe(result);
});
it('does not turn a positive sub-one sample estimate into zero samples',()=>{
  expect(sampleHint(0.2)).toContain('不足 1');
  expect(sampleHint(0.2)).not.toContain('暂无样本');
  expect(sampleHint(0)).toBe('窗口内暂无样本');
  expect(sampleHint(-1)).toBe('样本计数不可用');
});
