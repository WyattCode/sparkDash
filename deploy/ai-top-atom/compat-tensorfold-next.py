from pathlib import Path
import re,hashlib
root=Path(__file__).resolve().parents[2];html=root/'dist/index.html';h=html.read_text();old=re.search(r'src="(/assets/[^" ]+\.js)"',h).group(1);s=(root/'dist'/old.lstrip('/')).read_text()
def replace(a,b,count=1):
 global s
 assert s.count(a)==count,(a[:100],s.count(a));s=s.replace(a,b)
replace('N&&e===`itl`?null:','N&&(e===`itl`||u(e)==null)?null:')
replace('(0,K.jsx)(rl,{label:`前缀缓存命中率`','(!N||u(`cache`)!=null)&&(0,K.jsx)(rl,{label:`前缀缓存命中率`')
replace('(0,K.jsxs)(`span`,{children:[`上下文 `,r.contextLength??`未采集`]})','r.contextLength!=null&&(0,K.jsxs)(`span`,{children:[`上下文 `,r.contextLength]})')
anchor='(f?.inference||f?.warmup)&&(0,K.jsx)(rl,{label:`推理验收 / 预热`'
cards='N&&[`prefill`,`decode`,`tpot`].map((e,t)=>u(e)==null?null:(0,K.jsx)(rl,{label:[`预填充耗时 P95`,`解码耗时 P95`,`每输出 Token 耗时 P95`][t],value:al(u(e),u(`${e}Samples`)),note:`服务启动以来 · ${co(u(`${e}Samples`))}${e===`tpot`?` · 单请求平均，非 Token 间隔`:``}`},e)),N&&u(`kv`)!=null&&(0,K.jsx)(rl,{label:`流上下文占用率`,value:il(u(`kv`)*100,`%`),note:`实时 · 单流缓存 / 上下文窗口，非全局缓存池`}),N&&u(`completed`)!=null&&(0,K.jsx)(rl,{label:`已完成请求`,value:ao(u(`completed`)),note:`服务启动以来 · 响应耗时样本计数，非 HTTP 成功数`}),N&&u(`disconnected`)!=null&&(0,K.jsx)(rl,{label:`客户端中断`,value:ao(u(`disconnected`)),note:`服务启动以来 · 回复结束前客户端离开`}),'
# Reuse the existing request count formatter, rather than assuming its minified name.
m=re.search(r'label:`处理中 / 排队中`,value:`\$\{([A-Za-z_$][\w$]*)\(u\(`running`\)\)',s);assert m
cards=cards.replace('ao(u(',m.group(1)+'(u(')
replace(anchor,cards+anchor)
# Keep the four metric cells; substitute a reported concurrency limit for unknown context.
replace('(0,K.jsx)(`span`,{children:`上下文容量`})','(0,K.jsx)(`span`,{children:u?`上下文容量`:`并发上限`})')
replace('title:u?`${l.toLocaleString(`zh-CN`)} tokens`:`未获取有效上下文容量`,children:d','title:u?`${l.toLocaleString(`zh-CN`)} tokens`:`服务端报告的最大批次`,children:u?d:i?.slotsTotal??`—`')
replace('(0,K.jsx)(`small`,{children:`每请求 token 上限`})','(0,K.jsx)(`small`,{children:u?`每请求 token 上限`:`服务端最大批次 · 请求`})')
# TensorFold details: show only reported counters, with correct native semantics.
anchor='(0,K.jsx)(Sc,{sparkId:t,llmPort:r,modelId:e?.modelId,onDecode:ie,onPrefill:ae,onRemoteDecode:V,onRemotePrefill:H})'
block='e?.backend===`tensorfold`&&(0,K.jsx)(`div`,{className:`grid grid-cols-2 gap-2 border-t border-border pt-3 sm:grid-cols-4`,children:[[`流上下文占用率`,e.kvCacheUsage,`%`,100],[`首 Token 延迟 P95`,e.ttftP95Seconds,` s`,1],[`总耗时 P95`,e.e2eP95Seconds,` s`,1],[`草稿 Token 接受率`,e.mtpAcceptanceRate,`%`,100],[`抢占次数`,e.preemptionsTotal,``,1]].filter(t=>t[1]!=null).map(t=>(0,K.jsxs)(`div`,{className:`space-y-0.5`,children:[(0,K.jsx)(`div`,{className:`text-[10px] text-muted`,children:t[0]}),(0,K.jsx)(`div`,{className:`font-tabular text-sm text-text`,children:`${(t[1]*t[3]).toLocaleString(`zh-CN`,{maximumFractionDigits:3})}${t[2]}`})]},t[0]))}),'
# Two launcher occurrences: insert only in the available-model branch.
assert s.count(anchor)==2;s=s.replace(anchor,block+anchor,1)
new='/assets/index-atom-'+hashlib.sha256(s.encode()).hexdigest()[:10]+'.js';(root/'dist'/new.lstrip('/')).write_text(s);html.write_text(h.replace(old,new));print(new)
