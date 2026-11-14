import fs from 'node:fs';
import path from 'node:path';
const RETENTION=6*60*60*1000, LIMIT=5000, MAX_SERIES=64;
const value=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0?n:null;
export class NativeOperationsHistory {
  constructor(file=null){
    this.file=file;this.rows=new Map();this.error=null;this.lastFlush=0;this.readBlocked=false;
    if(file)try{const saved=JSON.parse(fs.readFileSync(file,'utf8'));if(saved.version!==1||!Array.isArray(saved.rows))throw Error('invalid');
      for(const r of saved.rows.slice(-MAX_SERIES))if(typeof r.key==='string'&&r.labels&&typeof r.labels==='object'&&Array.isArray(r.points)&&['output','prefill','gpu','temperature','power'].includes(r.metric)){
        r.points=r.points.filter(p=>Array.isArray(p)&&Number.isFinite(p[0])&&p[0]>=0&&(p[1]===null||value(p[1])!==null)).slice(-LIMIT);this.rows.set(r.key,r);
      }
    }catch(e){if(e.code!=='ENOENT'){this.error='原生历史文件不可读，保留原文件';this.readBlocked=true;}}
  }
  record(snapshots,now=Date.now()){
    if(!Number.isFinite(now)||now<0)return;
    const add=(key,metric,labels,n)=>{
      let row=this.rows.get(key);if(!row){if(this.rows.size>=MAX_SERIES)this.rows.delete(this.rows.keys().next().value);row={key,metric,labels,points:[]};this.rows.set(key,row);}
      row.labels=labels;
      if(row.points.length&&row.points.at(-1)[0]>=now)return;
      row.points.push([now,value(n)]);row.points=row.points.filter(p=>p[0]>=now-RETENTION).slice(-LIMIT);
    };
    for(const s of snapshots){
      const gpuAt=s.telemetry?.updatedAt?.gpu, llmAt=s.telemetry?.updatedAt?.llm;
      const fresh=at=>s.online&&typeof at==='number'&&now>=at&&now-at<30000;
      for(const [metric,n] of [['gpu',s.metrics?.gpu?.usage],['temperature',s.metrics?.gpu?.temperature],['power',s.metrics?.gpu?.power?.draw]])
        add(`${s.id}:${metric}`,metric,{node:s.name,role:s.role||'standalone',instance:s.id},fresh(gpuAt)&&s.telemetry?.successful?.gpu?n:null);
      if(s.role==='worker'||s.workerNode)continue;
      for(const [i,l] of (s.metrics?.llm||[]).entries())if(l.backend==='tensorfold')for(const [metric,n] of [['output',l.generationTps],['prefill',l.prefillTps]]){
        const port=s.llmPorts?.[i]??s.llmPort;
        add(`${s.id}:${port}:${l.modelId}:${metric}`,metric,{node:s.name,role:s.role||'standalone',instance:`127.0.0.1:${port}`,model_name:l.modelId||''},fresh(llmAt)&&l.available?n:null);
      }
    }
    for(const [key,row]of this.rows){row.points=row.points.filter(p=>p[0]>=now-RETENTION);if(!row.points.length)this.rows.delete(key);}
    if(now-this.lastFlush>=60000)this.flush(now);
  }
  query(metric,minutes,now=Date.now()){
    const cutoff=now-minutes*60000;
    return {generatedAt:now,source:'native',storageError:this.error,series:[...this.rows.values()].filter(r=>r.metric===metric).map(r=>({labels:r.labels,points:r.points.filter(p=>p[0]>=cutoff&&p[0]<=now)})).filter(r=>r.points.length)};
  }
  flush(now=Date.now()){
    if(!this.file||this.readBlocked)return;this.lastFlush=now;try{fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify({version:1,rows:[...this.rows.values()]}),{mode:0o600});fs.renameSync(this.file+'.tmp',this.file);this.error=null;}catch{this.error='原生历史保存失败';}
  }
}
