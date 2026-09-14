import { useEffect, useRef, useState } from 'react';
import type { SparkSnapshot } from '../../api/types';
import { fetchOperations, fetchOperationsHistory, testSpark, fetchVerification, runVerification } from '../../api/client';
import { recordLabel, recordNote, verificationTone, type Verification } from './verificationModel';
import { completeSum, finite, gpuReady, metricValue, nodeIssues, percent, sampleHint, type Operations, type Series } from './operationsModel';
import { FleetEnergyCard } from './FleetEnergyCard';
import { buildDiagnostics } from './diagnostics';

function Stat({label, value, note, tone}: {label: string; value: string; note?: string; tone?: 'success'|'warning'|'danger'|'neutral'}) {
  return <div className="ops-stat"><span>{label}</span><strong className={`font-tabular${tone?' ops-status-value':''}`} data-tone={tone}>{value}</strong>{note && <small>{note}</small>}</div>;
}
const number = (v: number | null, unit = '') => v == null ? '未采集' : `${v.toFixed(1)}${unit}`;
const latency = (v: number | null, samples: number | null) => samples === 0 ? '暂无样本' : v == null ? '不可用' : v < 1 ? `${(v * 1000).toFixed(1)} ms` : `${v.toFixed(2)} s`;

function History() {
  const [metric, setMetric] = useState('output');
  const [minutes, setMinutes] = useState(30);
  const [series, setSeries] = useState<Series[]>([]);
  const [message, setMessage] = useState('正在加载历史数据…');
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true;
    setSeries([]); setMessage('正在加载历史数据…');
    const load = async () => {
      try { const d = await fetchOperationsHistory(metric, minutes); if (alive) {setSeries(d.series); setMessage(d.series.some(s => s.points.some(p => p[1] != null)) ? '' : '所选时间范围暂无数据');} }
      catch {if (alive) {setSeries([]); setMessage('历史采集不可用，请检查 Prometheus');}}
    };
    void load(); const timer = setInterval(load, 30000);
    return () => {alive = false; clearInterval(timer);};
  }, [metric, minutes]);
  useEffect(() => {
    const element = canvas.current; if (!element) return;
    function draw() {
      if (!element) return;
      const width = element.clientWidth, height = 180, ratio = window.devicePixelRatio || 1;
      element.width = width * ratio; element.height = height * ratio;
      const ctx = element.getContext('2d'); if (!ctx) return;
      ctx.scale(ratio, ratio);
      const css = getComputedStyle(document.documentElement);
      const points = series.flatMap(s => s.points);
      const end = Math.max(Date.now(), ...points.map(p => p[0])); const start = end - minutes * 60000;
      const max = Math.max(1, ...points.map(p => p[1] ?? 0));
      ctx.font = '11px sans-serif'; ctx.fillStyle = css.getPropertyValue('--color-muted');
      for (let i = 0; i <= 3; i++) {
        const y = 12 + i * 45;
        ctx.strokeStyle = css.getPropertyValue('--color-border');ctx.beginPath();ctx.moveTo(48,y);ctx.lineTo(width - 10,y);ctx.stroke();
        ctx.fillText((max * (1-i/3)).toFixed(0), 2, y+4);
      }
      series.forEach((s) => {
        const worker=s.labels.role==='worker';
        ctx.strokeStyle = css.getPropertyValue(worker ? '--color-chart-secondary' : '--color-chart-primary'); ctx.setLineDash(worker?[5,3]:[]); ctx.lineWidth = 1.7;ctx.beginPath();
        let previous: number | null = null;
        s.points.forEach(([at,value]) => {
          if (value == null) {previous = null;return;}
          const x = 48 + (at-start)/(end-start)*(width-58), y = 147 - value/max*135;
          if (previous == null || at - previous > Math.max(45000, minutes*60000/80)) ctx.moveTo(x,y); else ctx.lineTo(x,y);
          previous=at;
        });ctx.stroke();
      });
      ctx.setLineDash([]);ctx.fillStyle = css.getPropertyValue('--color-muted');
      ctx.fillText(new Date(start).toLocaleTimeString('zh-CN'),48,173);
      ctx.fillText(new Date(end).toLocaleTimeString('zh-CN'),Math.max(48,width-75),173);
    }
    const resize = new ResizeObserver(draw); resize.observe(element);
    const theme = new MutationObserver(draw); theme.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});draw();
    return () => {resize.disconnect();theme.disconnect();};
  },[series,minutes]);
  return <section className="ops-section"><div className="ops-heading"><h2>性能历史</h2><div className="ops-controls">
    <select aria-label="历史指标" value={metric} onChange={e=>setMetric(e.target.value)}>{[['output','输出吞吐 · tok/s'],['prefill','输入吞吐 · tok/s'],['gpu','GPU 利用率 · %'],['temperature','GPU 温度 · °C'],['power','GPU 功耗 · W']].map(([v,l])=><option value={v} key={v}>{l}</option>)}</select>
    <select aria-label="历史时间范围" value={minutes} onChange={e=>setMinutes(Number(e.target.value))}><option value={30}>过去 30 分钟</option><option value={60}>过去 1 小时</option><option value={360}>过去 6 小时</option></select>
  </div></div><p className="ops-note">Prometheus 历史 · 吞吐为 5 分钟速率 · 每 30 秒刷新 · 断点保留为缺口</p>
    {message ? <p role="status" className="ops-empty">{message}</p> : <><canvas ref={canvas} className="ops-chart" role="img" aria-label="所选指标的历史曲线，当前值见下方图例"/><div className="ops-legend">{series.map((s,i)=><span key={i}>{s.labels.node || s.labels.instance} {s.labels.model_name}：{number(s.points.at(-1)?.[1] ?? null)}</span>)}</div></>}
  </section>;
}

export function OperationsPanel({sparks, stale, onSelect}: {sparks: SparkSnapshot[]; stale: boolean; onSelect?: (id: string) => void}) {
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [data,setData] = useState<Operations | null>(null);
  const [error,setError] = useState<string | null>(null);
  const [loading,setLoading] = useState(false);
  const [tab,setTab] = useState('service');
  const [now,setNow] = useState(Date.now());
  const [checks,setChecks] = useState<Record<string,string>>({});
  const [checking,setChecking] = useState<string | null>(null);
  const [verification,setVerification]=useState<Verification|null>(null);
  const [verifying,setVerifying]=useState(false);
  const [verifyMessage,setVerifyMessage]=useState('');
  useEffect(()=>{
    let alive=true;
    async function load(){try{const d=await fetchVerification();if(alive)setVerification(d);}catch{if(alive)setVerification(null);}}
    void load();const timer=setInterval(load,30000);
    return()=>{alive=false;clearInterval(timer);};
  },[]);
  async function verifyService(){
    if(!window.confirm('将发送 1 次短文本和 1 次小图像识别请求，每次最多 32 个输出 Token。模型忙碌时不执行，每 5 分钟最多一次；不会重跑 47 项预热，不修改模型配置。继续？'))return;
    setVerifying(true);setVerifyMessage('轻量验收中，请勿重复操作…');
    try{const d=await runVerification();setVerification(d);setVerifyMessage('验收已完成，请查看各项结果；单项未通过不代表模型不支持该能力。');}
    catch(e){setVerifyMessage(e instanceof Error?e.message:'验收失败');try{setVerification(await fetchVerification());}catch{setVerification(null);}}
    finally{setVerifying(false);}
  }
  useEffect(()=>{
    let alive=true;
    async function load(){try{const d=await fetchOperations();if(alive){setData(d);setError(null);}}catch{if(alive)setError('监控数据暂不可用');}}
    void load();const timer=setInterval(load,15000);const clock=setInterval(()=>setNow(Date.now()),1000);
    return()=>{alive=false;clearInterval(timer);clearInterval(clock);};
  },[]);
  const old = stale || !!error || !data || !!data.targetError || now-data.generatedAt>45000;
  const services=sparks.filter(s=>s.role!=='worker'&&!s.workerNode&&s.llmMonitoring!==false);
  const issues=sparks.flatMap(s=>nodeIssues(s).map(message=>({id:s.id,name:s.name,message})));
  const missingTargets = data && !data.targetError ? sparks.flatMap(s => {
    const jobs = ['node', ...(s.kind === 'host' ? [] : ['dcgm']), ...(s.role === 'head' && s.metrics.llm.some(l=>l.backend==='vllm') ? ['vllm','vllm-config'] : [])];
    return jobs.filter(job=>!data.targets.some(t=>t.labels.node===s.name&&t.labels.job===job)).map(job=>`${s.name} / ${job}`);
  }) : [];
  function download(){
    let url: string | undefined;
    try {
      const diagnostic=buildDiagnostics(sparks,data,old);
      url=URL.createObjectURL(new Blob([JSON.stringify(diagnostic,null,2)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download='sparkdash-diagnostics.json';a.click();
      setExportNote('已生成匿名诊断文件，请检查浏览器下载；不含节点名称、地址、凭据、自定义标签或事件原文。');
    } catch { setExportNote('诊断导出失败，请重试或检查浏览器下载权限。'); }
    finally { if (url) { const objectUrl=url; setTimeout(()=>URL.revokeObjectURL(objectUrl),1000); } }
  }
  async function refresh(){setLoading(true);try{setData(await fetchOperations());setError(null);}catch{setError('监控数据暂不可用');}finally{setLoading(false);}}
  async function checkNode(id:string) {
    setChecking(id);
    try {
      const result=await testSpark(id);
      const summary=result.capabilities?.map(c=>`${c.id}：${c.status==='pass'?'通过':c.status==='skipped'?'不适用':c.status==='fail'?'失败':'未确认'}`).join('；')||'检查完成';
      setChecks(prev=>({...prev,[id]:`${new Date().toLocaleTimeString('zh-CN')} · ${summary}（连通检查，非推理验收）`}));
    } catch {setChecks(prev=>({...prev,[id]:'检查失败，请查看节点详情'}));}
    finally {setChecking(null);}
  }
  return <section className="ops-console" aria-label="模型服务控制台">
    <div className="ops-heading"><div><h2>模型服务控制台</h2><p className="ops-note">{error || (data ? `监控更新：${new Date(data.generatedAt).toLocaleTimeString('zh-CN')} · ${old?'数据已过期':'数据有效'}` : '正在读取监控…')}</p></div><div className="ops-controls"><button className="ui-action-primary" onClick={()=>void refresh()} disabled={loading}>{loading?'检查中…':'检查监控'}</button><button onClick={download}>导出诊断</button><a href={`http://${location.hostname}:3000/`} target="_blank" rel="noreferrer">Grafana 看板</a></div></div>
    {exportNote && <p role="status" className="ops-note">{exportNote}</p>}
    <div className="ops-grid ops-health">
      <Stat label="节点在线" value={stale?'数据已过期':`${sparks.filter(s=>s.online).length} / ${sparks.length}`} note="包含隐藏或筛选掉的节点"/>
      <Stat label="GPU 指标" value={stale?'数据已过期':`${sparks.filter(gpuReady).length} / ${sparks.length}`} note="有效采集独立于主机在线"/>
      <Stat label="模型 API 探测" value={stale?'数据已过期':`${services.filter(s=>s.online&&s.metrics.llm.some(l=>l.available)).length} / ${services.length}`} note="接口可达不代表推理验收通过"/>
      <Stat label="当前节点异常" value={stale?'未知':String(new Set(issues.map(i=>i.id)).size)} note="离线、指标缺失、API、降频及磁盘"/>
    </div>
    {!!issues.length&&<div className="ops-alerts">{issues.map((v,i)=><button key={i} onClick={()=>onSelect?.(v.id)}>{v.name}：{v.message} · 查看节点</button>)}</div>}
    {!!missingTargets.length&&<p role="status" className="ops-missing">预期采集目标缺失：{missingTargets.join('、')}。请核对采集配置及节点标签。</p>}
    <nav className="ops-tabs" aria-label="监控分类">{[['service','模型服务'],['history','性能历史'],['network','互联与诊断'],['energy','能耗效率'],['events','异常时间线']].map(([v,label])=><button key={v} aria-pressed={tab===v} onClick={()=>setTab(v)}>{label}</button>)}</nav>
    {tab==='service'&&<div>{services.length===0?<p className="ops-empty">尚未配置模型服务</p>:services.map(s=><div className="ops-service" key={s.id}>
      {s.metrics.llm.length===0?<><div className="ops-heading"><h3>{s.name}</h3><button onClick={()=>onSelect?.(s.id)}>服务详情</button></div><p className="ops-empty">等待模型 API 指标</p></>:s.metrics.llm.map((llm,i)=>{
        const port=s.llmPorts?.[i]??s.llmPort;
        const candidates=data?.targets.filter(t=>t.labels.node===s.name&&t.labels.job==='vllm'&&t.labels.instance.endsWith(`:${port}`))||[];
        const target=candidates.length===1?candidates[0]:null;
        const usable=!old&&!!target&&target.health==='up'&&now-Date.parse(target.lastScrape)<45000;
        const v=(key:string)=>usable?metricValue(data,key,s.name,target?.labels.instance):null;
        const httpTotal=v('httpTotal');
        const check=verification?.supported&&verification.node===s.name&&verification.port===port&&verification.model===llm.modelId?verification:null;
        const checkFresh=!!check&&now-check.checkedAt<65000&&!stale&&s.online&&llm.available;
        const authLabel=!checkFresh?'鉴权探测不可用':({verified:'鉴权已验证',open:'接口未受保护',missing_key:'未配置探测密钥',rejected:'密钥被拒绝'}[check?.auth?.status??'']||'鉴权探测不可用');
        return <div className="ops-model-service" key={port}>
          <header className="ops-service-header">
            <div className="ops-service-identity">
              <h3>{llm.modelId||'模型信息未采集'}</h3>
              <div className="ops-service-meta"><span>{s.name}</span><span>{llm.backend||'未知后端'} · 端口 {port}</span><span>上下文 {llm.contextLength??'未采集'}</span></div>
            </div>
            <button className="ops-service-link" onClick={()=>onSelect?.(s.id)}>服务详情</button>
          </header>
          <div className="ops-grid">
            <Stat label="输出吞吐" value={stale||!s.online||!llm.available?'不可用':number(finite(llm.generationTps),' tok/s')} note="模型服务口径，不按 Worker 重复统计"/>
            <Stat label="输入吞吐" value={stale||!s.online||!llm.available?'不可用':number(finite(llm.prefillTps),' tok/s')} note="预填充，与输出分开统计"/>
            <Stat label="运行 / 排队请求" value={`${number(v('running'))} / ${number(v('waiting'))}`}/>
            <Stat label="推理接口 HTTP 成功率" value={usable?percent(v('httpOk'),httpTotal):'未采集'} note={`过去 30 分钟 · ${httpTotal==null?'无计数':`约 ${Math.round(httpTotal)} 次响应`} · 不含健康探测；不代表流式完成率`}/>
            {(['ttft','itl','e2e'] as const).map((k,j)=><Stat key={k} label={['首 Token 延迟 P95','Token 间延迟 P95','总耗时 P95'][j]} value={latency(v(k),v(`${k}Samples`))} note={`服务端 · 过去 30 分钟 · ${sampleHint(v(`${k}Samples`))}${k==='itl'?'（Token 间隔）':''}`}/>)}
            <Stat label="排队延迟 P95" value={latency(v('queue'),v('queueSamples'))} note={`过去 30 分钟 · ${sampleHint(v('queueSamples'))}`}/>
            <Stat label="前缀缓存命中率" value={v('cache')==null?'暂无样本':number((v('cache') as number)*100,'%')} note="过去 30 分钟 · 命中 / 查询"/>
            <Stat label="鉴权状态" value={authLabel} tone={!checkFresh?'neutral':check?.auth?.status==='verified'?'success':check?.auth?.status==='open'||check?.auth?.status==='rejected'?'danger':'neutral'} note={checkFresh?`匿名 ${check?.auth?.anonymous??'未测'} / 错误密钥 ${check?.auth?.invalid??'未测'} / 有效密钥 ${check?.auth?.keyed??'未测'} · ${new Date(check!.checkedAt).toLocaleTimeString('zh-CN')} · 模型列表接口`:'等待新鲜探测结果；不展示密钥'}/>
            <Stat label="推理验收 / 预热" value={recordLabel(check?.inference,checkFresh&&check?.current?.inference,'inference')} tone={verificationTone(check?.inference,checkFresh&&check?.current?.inference)} note={recordLabel(check?.warmup,checkFresh&&check?.current?.warmup,'warmup')+' · 详见验收记录'}/>
            <Stat label="多模态能力" value={recordLabel(check?.vision,checkFresh&&check?.current?.vision,'vision')} tone={verificationTone(check?.vision,checkFresh&&check?.current?.vision)} note="仅核验图像输入；不代表音频、视频或完整视觉质量评测"/>
          </div>
          <div className="ops-service-footer">
            <details className="ops-service-details">
              <summary>验收与请求详情</summary>
              <div className="ops-service-detail-grid">
                <section aria-label="验收记录">
                  <h4>验收记录</h4>
                  {check ? <>{(['inference','warmup','vision'] as const).map(kind=><p className="ops-note" key={kind}><b>{recordLabel(check[kind],checkFresh&&check.current?.[kind],kind)}</b>：{recordNote(check[kind])}</p>)}<p className="ops-note">记录关联模型启动标识，重启或模型不匹配后标为历史。预热不会由看板自动执行，启动记录需导入。</p></> : <p className="ops-note">验收记录暂不可用，等待探测结果。</p>}
                  <p className="ops-note">复验仅发送短文本和小图像请求，忙碌时拒绝，每 5 分钟最多一次；不执行预热，不修改配置，不代表完整质量评测。</p>
                </section>
                <section aria-label="请求统计">
                  <h4>请求统计 <small>过去 30 分钟</small></h4>
                  <div className="ops-legend">{['finished','httpErrors'].flatMap(k=>usable?(data?.metrics[k]?.series||[]).filter(r=>r.labels.node===s.name&&r.labels.instance===target?.labels.instance).map((r,n)=><span key={`${k}${n}`}>{r.labels.finished_reason||r.labels.status}：{number(r.points.at(-1)?.[1]??null)}</span>):[])}</div>
                  <p className="ops-note">请求结束原因与 HTTP 错误；缺失计数不推断为零，HTTP 成功不等同于推理完成。</p>
                </section>
              </div>
            </details>
            {check&&<button className="ops-verify-action" title="轻量复验：文本 + 图像" disabled={verifying||check.running||!checkFresh} onClick={()=>void verifyService()}>{verifying||check.running?'验收中…':'运行复验'}</button>}
          </div>
          {check&&verifyMessage&&<p role="status" className="ops-note">{verifyMessage}</p>}
          {check?.storageError&&<p role="alert" className="ops-note">{check.storageError}</p>}
          {!usable&&<p className="ops-note">{old?'监控未就绪或已过期':'该服务未匹配到新鲜的 Prometheus 采集目标'}；窗口指标保留不可用状态。</p>}
        </div>;
      })}
    </div>)}</div>}
    {tab==='history'&&<History/>}
    {tab==='network'&&<div className="ops-section"><h3>采集目标与互联诊断</h3><p className="ops-note">{data?.targetError||`${data?.targets.filter(t=>t.health==='up').length??0} / ${data?.targets.length??0} 个目标抓取正常`} · 分别核对每个节点，目标缺失不计为正常</p>
      <div className="ops-table-wrap"><table><thead><tr><th>节点</th><th>采集服务</th><th>状态</th><th>最后抓取</th></tr></thead><tbody>{data?.targets.map((t,i)=><tr key={i}><td>{t.labels.node||t.labels.instance}</td><td>{t.labels.job}</td><td>{old?'已过期':t.health==='up'?'正常':'失败'}</td><td>{new Date(t.lastScrape).toLocaleTimeString('zh-CN')}</td></tr>)}</tbody></table></div>
      {sparks.map(s=><div key={s.id} className="ops-service"><div className="ops-heading"><h3>{s.name} · 网络接口</h3><button disabled={checking!==null} onClick={()=>void checkNode(s.id)}>{checking===s.id?'连通检查中…':'检查节点连通性'}</button></div>{checks[s.id]&&<p role="status" className="ops-note">{checks[s.id]}</p>}<p className="ops-note">接口 up 仅代表链路状态；RDMA / NCCL / Rank 尚未接入独立验证。</p>
        {(s.metrics.network?.interfaces||[]).filter(n=>!n.disabled&&n.ip&&n.name!=='lo').map(n=><p className="ops-network" key={n.name}><b>{n.name}</b><span>{n.ip} · {n.operstate==='up'?'链路在线':n.operstate==='down'?'链路断开':'状态未知'}</span><span>{stale||!s.online?'数据不可用':`接收 ${number(finite(n.rxSpeed)==null?null:n.rxSpeed/1048576,' MB/s')} / 发送 ${number(finite(n.txSpeed)==null?null:n.txSpeed/1048576,' MB/s')}`}</span></p>)}
        {!s.metrics.network&&<p>网络指标未采集</p>}
        <p className="ops-note">端到端带宽、时延：未测量。吞吐量不代表链路带宽。</p>
      </div>)}
      <div className="ops-grid">{['networkErrors','networkDrops'].map((k,i)=><Stat key={k} label={i?'网卡丢弃 · 次/s':'网卡错误 · 次/s'} value={old||data?.metrics[k]?.error?'不可用':number(completeSum(data?.metrics[k]?.series||[]))} note="已采集物理接口统计；缺失时不汇总，不等于端到端丢包率"/>)}</div>
      <p className="ops-note">建议顺序：确认数据新鲜度 → 检查对应采集目标 → 查看节点与模型 API 状态 → 按交接文档处理。监控异常不触发模型重启。</p>
    </div>}
    {tab==='energy'&&<div className="ops-section"><FleetEnergyCard nodeCount={sparks.length}/><p className="ops-note">能耗为既有估算模型，非墙上电表实测；缺少完整覆盖时不外推。输出 Token 能效按服务计数，不按 Worker 复制。</p><div className="ops-grid">{sparks.map(s=><Stat key={s.id} label={`${s.name} · GPU 功耗`} value={stale||!gpuReady(s)?'不可用':number(finite(s.metrics.gpu?.power.draw),' W')} note="GPU 遥测，不等于整机功耗"/>)}</div></div>}
    {tab==='events'&&<div className="ops-section"><h3>采集状态事件</h3>{data?.eventStorageError&&<p role="alert">{data.eventStorageError}</p>}<p className="ops-note">最近 100 条持久记录 · 页面轮询时记录 · 无人查看时不采集事件 · 非完整操作审计日志</p>{data?.events.length?<ol className="ops-events">{data.events.map((e,i)=><li key={i}><time>{new Date(e.at).toLocaleString('zh-CN')}</time><b>{e.node}</b><span>{e.message}</span></li>)}</ol>:<p className="ops-empty">尚无事件记录</p>}</div>}
  </section>;
}
