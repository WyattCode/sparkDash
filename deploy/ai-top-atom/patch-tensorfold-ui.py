#!/usr/bin/env python3
"""Patch the preserved .233 compiled UI, without replacing its accepted layout.
Run once on the pre-TensorFold snapshot. Each replacement must match exactly once.
The current frontend.tar.gz already contains the result; normal restore needs no patch.
"""
from pathlib import Path
import hashlib
import re

root=Path(__file__).resolve().parents[2]
html=root/'dist/index.html'
entry=re.search(r'src="(/assets/[^" ]+\.js)"',html.read_text()).group(1)
p=root/'dist'/entry.lstrip('/')
s=p.read_text()
replacements=[
('c=s.length===1?s[0]:null,l=', 'c=s.length===1?s[0]:null,N=r.backend===`tensorfold`,l='),
('label:`推理接口 HTTP 成功率`,value:l?so(u(`httpOk`),d):`未采集`,note:`过去 30 分钟', 'label:`推理接口 HTTP 成功率`,value:N?`后端未提供`:l?so(u(`httpOk`),d):`未采集`,note:N?`TensorFold 未暴露推理 HTTP 状态计数；不能用健康探测代替`:`过去 30 分钟'),
('value:al(u(e),u(`${e}Samples`)),note:`服务端 · 过去 30 分钟', 'value:N&&e===`itl`?`后端未提供`:al(u(e),u(`${e}Samples`)),note:N&&e===`itl`?`TensorFold 未暴露 Token 间延迟直方图`:`服务端 · ${N?`服务启动以来`:`过去 30 分钟`}'),
('label:`排队延迟 P95`,value:al(u(`queue`),u(`queueSamples`)),note:`过去 30 分钟', 'label:`排队延迟 P95`,value:N?`后端未提供`:al(u(`queue`),u(`queueSamples`)),note:N?`TensorFold 未暴露排队延迟直方图`:`过去 30 分钟'),
('note:`过去 30 分钟 · 命中 / 查询`','note:N?`服务启动以来 · 缓存 Token / 输入 Token`:`过去 30 分钟 · 命中 / 查询`'),
('label:`推理验收 / 预热`,value:$c(f?.inference,m&&f?.current?.inference,`inference`)','label:`推理验收 / 预热`,value:N&&!f?.inference?`尚未执行独立验收`:$c(f?.inference,m&&f?.current?.inference,`inference`)'),
('note:$c(f?.warmup,m&&f?.current?.warmup,`warmup`)+` · 详见验收记录`','note:N&&!f?.warmup?(m?`模型 API 可达；尚未导入预热实测记录`:`尚未导入预热实测记录`):$c(f?.warmup,m&&f?.current?.warmup,`warmup`)+` · 详见验收记录`'),
('label:`多模态能力`,value:$c(f?.vision,m&&f?.current?.vision,`vision`)','label:`多模态能力`,value:N&&!f?.vision?`图像输入尚未核验`:$c(f?.vision,m&&f?.current?.vision,`vision`)'),
('title:`轻量复验：文本 + 图像`,disabled:S||f.running||!m','title:f.reason||`轻量复验：文本 + 图像`,disabled:S||f.running||!m||f.canVerify===!1'),
]
for before,after in replacements:
    if s.count(before)!=1:
        raise SystemExit('Unexpected input; patch cancelled: '+before)
    s=s.replace(before,after,1)
name='index-atom-'+hashlib.sha256(s.encode()).hexdigest()[:10]+'.js'
(root/'dist/assets'/name).write_text(s)
html.write_text(html.read_text().replace(entry,'/assets/'+name))
print('Updated entry:',name)
