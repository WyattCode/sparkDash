export interface VerificationRecord {
  model:string; boot:string|null; at:string|null; status:string; source:string; detail:string;
  passed?:number; total?:number; durationMs?:number;
}
export interface Verification {
  checkedAt:number; supported:boolean; reason?:string; node?:string; port?:number; model?:string; boot?:string|null;
  running?:boolean; storageError?:string|null;
  auth?:{status:string;anonymous:number|null;invalid:number|null;keyed:number|null};
  inference?:VerificationRecord|null; warmup?:VerificationRecord|null; vision?:VerificationRecord|null;
  current?:{inference:boolean;warmup:boolean;vision:boolean};
}
export function recordLabel(r:VerificationRecord|null|undefined,current:boolean|undefined,kind:string) {
  if(!r)return '暂无验收记录';
  if(r.status==='declared')return '图像输入 · 已声明';
  const label=kind==='warmup'?`预热 ${r.passed??'?'} / ${r.total??'?'}`:kind==='vision'?'图像输入':'文本推理';
  return `${label} · ${r.status==='passed'?'通过':'未通过'}${current?'':'（历史）'}`;
}
export function recordNote(r:VerificationRecord|null|undefined) {
  return r?`${r.at?new Date(r.at).toLocaleString('zh-CN'):'日期未记录'} · ${r.source} · ${r.detail}`:'尚未记录；不会将 API 可达当作验收通过';
}
export function verificationTone(r:VerificationRecord|null|undefined,current:boolean|undefined):'success'|'danger'|'neutral' {
  if(!current||!r)return 'neutral';
  return r.status==='passed'?'success':r.status==='failed'?'danger':'neutral';
}
