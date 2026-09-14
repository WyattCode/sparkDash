import {describe,it,expect} from 'vitest';
import {recordLabel,recordNote,verificationTone,type VerificationRecord} from './verificationModel';
const record:VerificationRecord={model:'test',boot:'boot',at:'2026-09-13T14:07:00Z',status:'passed',source:'人工交接记录',detail:'测试记录',passed:47,total:47};
describe('验收记录不会把历史或声明变成实时通过',()=>{
  it('强调色只用于有依据的当前状态',()=>{
    expect(verificationTone(record,true)).toBe('success');
    expect(verificationTone(record,false)).toBe('neutral');
    expect(verificationTone({...record,status:'declared'},true)).toBe('neutral');
    expect(verificationTone({...record,status:'failed'},true)).toBe('danger');
  });
  it('区分缺失、当前、历史、失败及声明',()=>{
    expect(recordLabel(null,false,'vision')).toBe('暂无验收记录');
    expect(recordLabel(record,true,'inference')).toBe('文本推理 · 通过');
    expect(recordLabel(record,false,'inference')).toContain('历史');
    expect(recordLabel({...record,status:'failed'},true,'vision')).toContain('未通过');
    expect(recordLabel({...record,status:'declared'},true,'vision')).toContain('已声明');
  });
  it('预热数值和人工来源清楚保留',()=>{
    expect(recordLabel(record,true,'warmup')).toContain('47 / 47');
    expect(recordNote(record)).toContain('人工交接记录');
  });
});
