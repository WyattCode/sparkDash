// Selective adaptation of upstream 70e95c4 / 907386a (Acermax, MIT).
// Persist observed deltas, not engine-lifetime counts or restart baselines.
import fs from 'node:fs';
import { atomicWrite } from '../util/atomicWrite.js';

const DAY = 86400000;
const count = n => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : null;
const add = (a,b) => Math.min(Number.MAX_SAFE_INTEGER,a+b);
const keyOf = (...parts) => JSON.stringify(parts);
const dayOf = now => new Date(now).toISOString().slice(0,10);
const fields = ['completionTokens','promptTokens','cachedTokens'];

export function extractTokenObservations(snapshots, now=Date.now()) {
  const rows=[];
  for(const s of snapshots || []) {
    if(!s?.online || s.role==='worker' || s.workerNode || typeof s.id!=='string') continue;
    const time=s.telemetry?.updatedAt?.llm;
    if(!Number.isFinite(time) || now-time<0 || now-time>10000) continue;
    const entries=s.metrics?.llm,ports=s.llmPorts;
    if(!Array.isArray(entries)||!Array.isArray(ports)||entries.length!==ports.length) continue;
    for(let i=0;i<entries.length;i++) {
      const e=entries[i],c=e?.tokenCounters,port=ports[i];
      if(!e?.available||!c||count(c.output)==null||!Number.isInteger(port)||port<1||port>65535) continue;
      if(typeof e.modelId!=='string'||!e.modelId.trim()||typeof c.source!=='string') continue;
      rows.push({sparkId:s.id,port,modelId:e.modelId.trim().slice(0,300),output:c.output,
        prompt:count(c.prompt),cached:count(c.cached),
        source:keyOf(s.isLocal,s.lanIp,e.backend,c.source)});
    }
  }
  return rows;
}

export class LlmTokenLedger {
  constructor(filePath, {write=atomicWrite}={}) {
    this.filePath=filePath;this._write=write;this.rows=new Map();this.baselines=new Map();
    this.dirty=false;this.persistenceError=null;this.writeBlocked=false;
    this.startedAt=Date.now();
    if(!filePath||!fs.existsSync(filePath))return;
    try {
      const data=JSON.parse(fs.readFileSync(filePath,'utf8'));
      if(data.version!==1||!Array.isArray(data.rows)||data.rows.length>2000)throw Error('Invalid token ledger');
      for(const r of data.rows) {
        if(typeof r.sparkId!=='string'||typeof r.modelId!=='string'||!Number.isInteger(r.port))continue;
        if(r.sparkId.length>100||r.modelId.length>300||r.port<1||r.port>65535)continue;
        const totals=this._readTotals(r);
        if(!totals||!Number.isFinite(r.lastSeenAt))continue;
        const daily={};
        for(const [day,values] of Object.entries(r.daily || {}).sort().slice(-35)) {
          if(!/^\d{4}-\d{2}-\d{2}$/.test(day))continue;
          const clean=this._readTotals(values);if(clean)daily[day]=clean;
        }
        this.rows.set(keyOf(r.sparkId,r.port,r.modelId),{sparkId:r.sparkId,port:r.port,modelId:r.modelId,
          ...totals,lastSeenAt:r.lastSeenAt,daily});
      }
      if(Number.isFinite(data.startedAt))this.startedAt=data.startedAt;
    }catch {
      this.persistenceError='Token 历史文件无法读取，已停止覆盖原文件。';this.writeBlocked=true;
    }
  }

  _readTotals(r) {
    if(!r||count(r.completionTokens)==null)return null;
    const promptTokens=count(r.promptTokens), cachedTokens=count(r.cachedTokens);
    return {completionTokens:r.completionTokens,promptTokens,
      cachedTokens:promptTokens==null||cachedTokens==null?null:Math.min(promptTokens,cachedTokens)};
  }

  record(observations,now=Date.now()) {
    if(!Number.isFinite(now)||now<0||now>8.64e15)return;
    const seen=new Set();
    for(const obs of observations) {
      if(count(obs.output)==null||!obs.modelId||!obs.sparkId)continue;
      const key=keyOf(obs.sparkId,obs.port);if(seen.has(key))continue;seen.add(key);
      const prev=this.baselines.get(key);this.baselines.set(key,{...obs,at:now});
      if(!prev||prev.modelId!==obs.modelId||prev.source!==obs.source||now<=prev.at||now-prev.at>45000)continue;
      const output=obs.output-prev.output;
      const prompt=obs.prompt!=null&&prev.prompt!=null?obs.prompt-prev.prompt:null;
      const cached=obs.cached!=null&&prev.cached!=null?obs.cached-prev.cached:null;
      if([output,prompt,cached].some(n=>n!=null&&(n<0||n>1e9)))continue;
      if(output===0&&!(prompt>0))continue;
      const delta={completionTokens:output,promptTokens:prompt,
        cachedTokens:prompt==null||cached==null?null:Math.min(cached,prompt)};
      const rowKey=keyOf(obs.sparkId,obs.port,obs.modelId);
      let row=this.rows.get(rowKey);
      if(!row){row={sparkId:obs.sparkId,port:obs.port,modelId:obs.modelId,
        completionTokens:0,promptTokens:0,cachedTokens:0,lastSeenAt:now,daily:{}};this.rows.set(rowKey,row);}
      const day=dayOf(now);
      const bucket=row.daily[day]??={completionTokens:0,promptTokens:0,cachedTokens:0};
      for(const f of fields) {
        row[f]=row[f]==null||delta[f]==null?null:add(row[f],delta[f]);
        bucket[f]=bucket[f]==null||delta[f]==null?null:add(bucket[f],delta[f]);
      }
      row.lastSeenAt=now;this.dirty=true;
    }
    // Missing/offline endpoints must re-seed, not attribute an unobserved gap.
    for(const key of this.baselines.keys())if(!seen.has(key))this.baselines.delete(key);
    for(const row of this.rows.values())for(const day of Object.keys(row.daily)) {
      if(day<dayOf(now-34*DAY)){delete row.daily[day];this.dirty=true;}
    }
    if(this.rows.size>2000){
      const oldest=[...this.rows.entries()].sort((a,b)=>a[1].lastSeenAt-b[1].lastSeenAt);
      for(const [key] of oldest.slice(0,this.rows.size-2000))this.rows.delete(key);
    }
  }

  snapshot(range='today',now=Date.now()) {
    const days={today:1,'7d':7,'30d':30};
    if(!['today','7d','30d','all'].includes(range))range='today';
    const cutoff=range==='all'?null:dayOf(now-(days[range]-1)*DAY),today=dayOf(now);
    const rows=[...this.rows.values()].map(r=>{
      let totals=this._readTotals(r);
      if(cutoff){totals={completionTokens:0,promptTokens:0,cachedTokens:0};
        for(const [day,b] of Object.entries(r.daily))if(day>=cutoff&&day<=today){
          for(const f of fields)totals[f]=totals[f]==null||b[f]==null?null:add(totals[f],b[f]);
        }
      }
      return {sparkId:r.sparkId,port:r.port,modelId:r.modelId,lastSeenAt:r.lastSeenAt,...totals};
    }).filter(r=>r.completionTokens>0||r.promptTokens>0).sort((a,b)=>b.lastSeenAt-a.lastSeenAt);
    return {range,timeZone:'UTC',startedAt:this.startedAt,persistenceError:this.persistenceError,rows};
  }

  flush() {
    if(this.writeBlocked)throw Error(this.persistenceError);
    if(!this.dirty||!this.filePath)return;
    try {
      this._write(this.filePath,JSON.stringify({version:1,startedAt:this.startedAt,rows:[...this.rows.values()]}));
      this.dirty=false;this.persistenceError=null;
    }catch(e){this.persistenceError='Token 台账暂未写入磁盘，将重试保存。';throw e;}
  }
}
