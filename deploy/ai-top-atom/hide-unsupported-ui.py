#!/usr/bin/env python3
"""Apply capability guards to the preserved compiled UI; snapshot includes result."""
from pathlib import Path
import hashlib,re
root=Path(__file__).resolve().parents[2];html=root/'dist/index.html';h=html.read_text();entry=re.search(r'src="(/assets/[^" ]+\.js)"',h).group(1);s=(root/'dist'/entry.lstrip('/')).read_text()
replacements=[
('(0,K.jsx)(rl,{label:`推理接口 HTTP 成功率`','!N&&(0,K.jsx)(rl,{label:`推理接口 HTTP 成功率`'),
('].map((e,t)=>(0,K.jsx)(rl,{label:[`首 Token 延迟 P95`','].map((e,t)=>N&&e===`itl`?null:(0,K.jsx)(rl,{label:[`首 Token 延迟 P95`'),
('(0,K.jsx)(rl,{label:`排队延迟 P95`','!N&&(0,K.jsx)(rl,{label:`排队延迟 P95`'),
('(0,K.jsx)(rl,{label:`推理验收 / 预热`','(f?.inference||f?.warmup)&&(0,K.jsx)(rl,{label:`推理验收 / 预热`'),
('(0,K.jsx)(rl,{label:`多模态能力`','f?.vision&&(0,K.jsx)(rl,{label:`多模态能力`'),
('(0,K.jsxs)(`div`,{className:`ops-service-footer`','(!N||f?.inference||f?.warmup||f?.vision)&&(0,K.jsxs)(`div`,{className:`ops-service-footer`'),
]
for before,after in replacements:
 if s.count(before)!=1:raise SystemExit('Unexpected input: '+before)
 s=s.replace(before,after,1)
name='index-atom-'+hashlib.sha256(s.encode()).hexdigest()[:10]+'.js';(root/'dist/assets'/name).write_text(s);html.write_text(h.replace(entry,'/assets/'+name));print(name)
