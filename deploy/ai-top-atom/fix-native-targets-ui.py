#!/usr/bin/env python3
from pathlib import Path
import re,hashlib
root=Path(__file__).resolve().parents[2];html=root/'dist/index.html';h=html.read_text();entry=re.search(r'src="(/assets/[^" ]+\.js)"',h).group(1);s=(root/'dist'/entry.lstrip('/')).read_text()
needle='(0,K.jsx)(rl,{label:`鉴权状态`'
start=s.index(needle)
if s[max(0,start-4):start]=='!1&&': start-=4
end=s.index('(f?.inference||f?.warmup)',start);s=s[:start]+s[end:]
old='A=a&&!a.targetError?e.flatMap(e=>';new='A=a&&!a.targetError?Array.isArray(a.expectedTargets)?a.expectedTargets.filter(e=>!a.targets.some(t=>t.labels.node===e.node&&t.labels.job===e.job)).map(e=>`${e.node} / ${e.job}`):e.flatMap(e=>'
assert s.count(old)==1;s=s.replace(old,new,1)
name='index-atom-'+hashlib.sha256(s.encode()).hexdigest()[:10]+'.js';(root/'dist/assets'/name).write_text(s);html.write_text(h.replace(entry,'/assets/'+name));print(name)
