// DGX production adapter: fixed endpoint, bounded probes, no model lifecycle actions.
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const MODEL = 'deepseek-v4.1-flash';
const BASE = 'http://127.0.0.1:8888';

export async function productionBoot() {
  const container = process.env.SPARKDASH_VERIFICATION_CONTAINER;
  if (!container || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(container)) return null;
  const args = ['docker', 'inspect', '--format', '{{.State.Running}} {{.State.StartedAt}}', container];
  const {stdout} = await exec('nsenter', ['-t','1','-m','--',...args], {timeout:5000,maxBuffer:4096});
  const [running, at] = stdout.trim().split(/\s+/);
  return running === 'true' && Number.isFinite(Date.parse(at)) ? new Date(at).toISOString() : null;
}

export function recordCurrent(record, boot, model) {
  return !!record && !!boot && record.boot === boot && record.model === model;
}

export function createServiceVerification({file, getSpark, snapshots, fetchImpl = fetch, getBoot = productionBoot, imageFile = process.env.SPARKDASH_VERIFICATION_IMAGE || '', nodeName = process.env.SPARKDASH_VERIFICATION_NODE || ''}) {
  let cache = null, pending = null, running = false, lastRun = 0;
  function matchesModel(modelId) {
    if (typeof modelId !== 'string' || !modelId.trim()) return false;
    const id = modelId.trim().toLowerCase();
    return id === MODEL || (id.split('/').filter(Boolean).pop() || '') === MODEL;
  }
  function target() {
    if (!nodeName) return null;
    const candidates = snapshots().filter(s=>s.name===nodeName&&s.isLocal&&s.role==='head');
    const s = candidates.length === 1 ? candidates[0] : null;
    const index = s?.metrics.llm.findIndex((l,i)=>matchesModel(l.modelId)&&(s.llmPorts?.[i]??s.llmPort)===8888) ?? -1;
    if (!s || index < 0) return null;
    return {node:s.name, model:s.metrics.llm[index].modelId, port:8888, key:getSpark(s.id)?.llmApiKeys?.['8888'] || ''};
  }
  function readRecords() {
    try {
      const records=JSON.parse(fs.readFileSync(file,'utf8'));
      if(!records||Array.isArray(records)||typeof records!=='object')throw new Error('invalid records');
      for(const kind of ['inference','warmup','vision']) {
        const r=records[kind];
        if(r!=null&&(!r||typeof r!=='object'||!['passed','failed','declared'].includes(r.status)||typeof r.model!=='string'||typeof r.source!=='string'||typeof r.detail!=='string'))throw new Error('invalid record');
      }
      return {records, storageError:null};
    }
    catch(e) {return {records:{},storageError:e.code==='ENOENT'?null:'验收记录读取失败，原文件未覆盖'};}
  }
  async function probe(path, key, body) {
    const res = await fetchImpl(BASE+path, {method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(body?90000:5000),headers:{...(key?{Authorization:`Bearer ${key}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    // Never expose raw response bodies or exception messages (may contain credentials).
    if (!res.ok) {await res.body?.cancel();return {status:res.status,data:null};}
    return {status:res.status,data:await res.json()};
  }
  async function load() {
    const t = target();
    if (!t) return {checkedAt:Date.now(),supported:false,reason:'当前服务未匹配双机生产验收适配器'};
    const boot = await getBoot().catch(()=>null);
    const auth = {status:'unavailable',anonymous:null,invalid:null,keyed:null};
    try {
      const [anon,invalid,keyed] = await Promise.all([probe('/v1/models',''),probe('/v1/models','sparkdash-intentionally-invalid-key'),t.key?probe('/v1/models',t.key):Promise.resolve(null)]);
      auth.anonymous=anon.status;auth.invalid=invalid.status;auth.keyed=keyed?.status??null;
      const listed = keyed?.data?.data?.some(m=>matchesModel(m.id));
      auth.status = anon.status===200 ? 'open' : [401,403].includes(anon.status)&&[401,403].includes(invalid.status)&&keyed?.status===200&&listed ? 'verified' : !t.key ? 'missing_key' : [401,403].includes(keyed?.status) ? 'rejected' : 'unavailable';
    } catch { /* explicit unavailable, never reuse an old success */ }
    const {records,storageError}=readRecords();
    return {checkedAt:Date.now(),supported:true,node:t.node,port:t.port,model:t.model,boot,auth,storageError,running,
      inference:records.inference||null,warmup:records.warmup||null,vision:records.vision||null,
      current:{inference:recordCurrent(records.inference,boot,t.model),warmup:recordCurrent(records.warmup,boot,t.model),vision:recordCurrent(records.vision,boot,t.model)}};
  }
  async function status(force=false) {
    if (!force&&cache&&Date.now()-cache.checkedAt<30000) return {...cache,running};
    pending ||= load().then(v=>(cache=v)).finally(()=>{pending=null;});
    return pending;
  }
  async function verify() {
    if (running) throw Object.assign(new Error('已有验收正在执行'),{status:409});
    if (Date.now()-Math.max(lastRun,Number(readRecords().records.lastAttemptAt)||0)<300000) throw Object.assign(new Error('轻量验收每 5 分钟最多一次'),{status:429});
    running=true;
    try {
      const t=target();
      if (!t) throw Object.assign(new Error('当前模型未匹配生产适配器'),{status:409});
      const state=await status(true);
      if (!state.boot||state.auth?.status!=='verified') throw Object.assign(new Error('先确认模型启动标识及鉴权通过'),{status:409});
      const saved=readRecords();
      if (saved.storageError) throw Object.assign(new Error(saved.storageError),{status:503});
      async function idle() {
        const unavailable = () => Object.assign(new Error('模型忙碌或空闲状态不确定，请稍后重试'),{status:409});
        async function query(expression) {
          const url = new URL('/api/v1/query', process.env.SPARKDASH_PROMETHEUS_URL || 'http://127.0.0.1:9090');
          url.searchParams.set('query', expression);
          const res = await fetchImpl(url, {signal:AbortSignal.timeout(5000)});
          const data = await res.json();
          const rows = data.data?.result;
          if (!res.ok || data.status !== 'success' || !Array.isArray(rows) || rows.length !== 1) throw unavailable();
          const row = rows[0];
          if (!row?.metric?.instance?.endsWith(':8888') || !Array.isArray(row.value) || typeof row.value[1] !== 'string' || !row.value[1].trim() || !Number.isFinite(Number(row.value[1]))) throw unavailable();
          return {instance:row.metric.instance, value:Number(row.value[1])};
        }
        const checks = await Promise.all(['sglang:num_running_reqs','sglang:num_queue_reqs','up'].map(async name => {
          const selector = `${name}{node=${JSON.stringify(t.node)},job="vllm"${name==='up'?'':`,model_name=${JSON.stringify(t.model)}`}}`;
          // timestamp() exposes the raw sample time; value[0] is query time.
          const [sample, stamp] = await Promise.all([query(selector),query(`timestamp(${selector})`)]);
          const age = Date.now()/1000-stamp.value;
          if (sample.instance !== stamp.instance || sample.value !== (name==='up'?1:0) || age < 0 || age > 15) throw unavailable();
          return sample.instance;
        }));
        if (new Set(checks).size !== 1) throw unavailable();
      }
      await idle();
      // Read fixture before generating requests, so missing assets fail without GPU work.
      const image=fs.readFileSync(imageFile).toString('base64');
      lastRun=Date.now();
      const records=saved.records;
      records.lastAttemptAt=lastRun;
      fs.writeFileSync(file+'.tmp',JSON.stringify(records,null,2),{mode:0o600});fs.renameSync(file+'.tmp',file);
      const base={model:t.model,boot:state.boot,source:'sparkDash 轻量实测（非完整质量/性能评测）'};
      async function run(kind,content,accept) {
        const start=Date.now();
        let passed=false,detail='请求失败或超时';
        try {
          const result=await probe('/v1/chat/completions',t.key,{model:t.model,messages:[{role:'user',content}],temperature:0,max_tokens:32,stream:false,chat_template_kwargs:{thinking:false}});
          const choice=result.data?.choices?.[0];
          passed=result.status===200&&choice?.finish_reason==='stop'&&accept(choice.message?.content||'');
          detail=passed?'HTTP 200 · 正常结束 · 回答校验通过':`HTTP ${result.status} · 未通过回答或结束状态校验`;
        } catch { /* bounded error text */ }
        records[kind]={...base,at:new Date().toISOString(),status:passed?'passed':'failed',durationMs:Date.now()-start,detail};
        fs.writeFileSync(file+'.tmp',JSON.stringify(records,null,2),{mode:0o600});fs.renameSync(file+'.tmp',file);
      }
      await run('inference','Reply with exactly SPARK_OK and nothing else.',text=>text.trim()==='SPARK_OK');
      if (records.inference.status==='passed') {
        await idle();
        await run('vision',[{type:'text',text:'What is the dominant color in this image? Reply with one English color word only.'},{type:'image_url',image_url:{url:`data:image/jpeg;base64,${image}`}}],text=>/^red[.!]?$/i.test(text.trim()));
      }
      if (await getBoot().catch(()=>null)!==state.boot) throw Object.assign(new Error('验收期间模型启动标识变化，结果已标为历史，请重新确认'),{status:409});
      cache=null;
      return {...await status(true),running:false};
    } finally {running=false;cache=null;}
  }
  return {status,verify};
}

export function registerVerificationRoutes(app, options) {
  const service=createServiceVerification(options);
  app.get('/api/operations/verification',async(_req,res)=>{try{res.json(await service.status());}catch{res.status(503).json({error:'验收数据暂不可用'});}});
  app.post('/api/operations/verification',async(req,res)=>{
    if(req.body?.confirm!==true)return res.status(400).json({error:'需要确认轻量推理与图像测试'});
    try {res.json(await service.verify());} catch(e){res.status(e.status||503).json({error:e.status?e.message:'验收执行或记录保存失败'});}
  });
}
