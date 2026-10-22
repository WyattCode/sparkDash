import { useState } from 'react';
import { Layers, Gauge, ScanText, ArrowUpRight } from 'lucide-react';
import type { LlmBenchTarget, SparkSnapshot } from '../../api/types';
import { isLlmMonitoringEnabled, isWorkerSpark } from '../../api/sparkRole';
import { displayName } from '../../displayName';
import { BenchmarkDialog } from '../SparkPage/BenchmarkDialog';
import { PrefillBenchDialog } from '../SparkPage/PrefillBenchDialog';
import { LlmLaunchers } from '../SparkPage/LlmPanel';

export function TestTools({sparks, shareImage}: {sparks: SparkSnapshot[]; shareImage: boolean}) {
  const choices = sparks.filter(s=>!isWorkerSpark(s)&&isLlmMonitoringEnabled(s)).flatMap(s=>(s.llmPorts?.length?s.llmPorts:[s.llmPort??8888]).map((port,i)=>({key:JSON.stringify([s.id,port]),spark:s,port,llm:s.metrics.llm[i]})));
  const [key,setKey] = useState('');
  const [dialog,setDialog] = useState<'decode'|'prefill'|null>(null);
  const [remote,setRemote] = useState<LlmBenchTarget|null>(null);
  const selected = choices.find(c=>c.key===key) ?? choices[0];
  const show = (kind:'decode'|'prefill', target:LlmBenchTarget|null = null) => {setRemote(target);setDialog(kind);};
  if(!selected) return <p className="panel p-6 text-sm text-muted">尚未配置可测试的模型服务。工作节点不作为独立模型测试。</p>;
  const {spark,port,llm} = selected;
  const params = new URLSearchParams({port:String(port)});if(llm?.modelId)params.set('model',llm.modelId);
  return <section className="test-tools">
    <div className="test-target"><label htmlFor="tool-model-target">测试对象</label><select id="tool-model-target" value={selected.key} disabled={dialog!==null} onChange={e=>setKey(e.target.value)}>{choices.map(c=><option value={c.key} key={c.key}>{displayName(c.spark.name)} · {c.llm?.modelId||'模型待识别'} · {c.port}</option>)}</select><span>按模型服务测试，不按设备重复计数</span></div>
    <div className="tool-grid">
      <article className="tool-card"><Layers aria-hidden="true"/><h2>并发生成</h2><p>同时发出多路请求，并排查看回答、首字延迟和每路生成表现。</p><small>适合观察多请求体验与排队</small><a href={`/showcase/${encodeURIComponent(spark.id)}?${params}`}>进入并发生成 <ArrowUpRight aria-hidden="true"/></a></article>
      <article className="tool-card"><Gauge aria-hidden="true"/><h2>解码基准</h2><p>测量开始输出后的生成速率，区分单路和并发解码表现。</p><small>不把首字等待时间计入解码速率</small><button onClick={()=>show('decode')}>配置解码测试</button></article>
      <article className="tool-card"><ScanText aria-hidden="true"/><h2>预填充基准</h2><p>测试不同输入长度下的提示词处理表现与缓存影响。</p><small>与输出 Token 生成速率分别统计</small><button onClick={()=>show('prefill')}>配置预填充测试</button></article>
    </div>
    <p className="workspace-note">打开配置不会启动测试。确认开始后才会占用推理资源；测试读数只覆盖本次请求，不代表整个模型服务的总吞吐。</p>
    <details className="tool-advanced"><summary>高级测试目标 · 远程主机与 SSH 隧道</summary><LlmLaunchers sparkId={spark.id} llmPort={port} modelId={llm?.modelId} onDecode={()=>show('decode')} onPrefill={()=>show('prefill')} onRemoteDecode={t=>show('decode',t)} onRemotePrefill={t=>show('prefill',t)}/></details>
    <BenchmarkDialog open={dialog==='decode'} onClose={()=>setDialog(null)} sparkId={spark.id} sparkName={displayName(spark.name)} llmPort={port} modelId={remote?null:llm?.modelId??null} remoteTarget={remote} shareImage={shareImage}/>
    <PrefillBenchDialog open={dialog==='prefill'} onClose={()=>setDialog(null)} sparkId={spark.id} sparkName={displayName(spark.name)} llmPort={port} modelId={remote?null:llm?.modelId??null} contextLength={remote?null:llm?.contextLength??null} remoteTarget={remote} shareImage={shareImage}/>
  </section>;
}
