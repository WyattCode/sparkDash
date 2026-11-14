"""Add supported TensorFold cards to the preserved production frontend."""
from pathlib import Path
import re, hashlib
root=Path(__file__).resolve().parents[2]
html=root/'dist/index.html'
h=html.read_text()
old=re.search(r'src="(/assets/[^" ]+\.js)"',h).group(1)
p=root/'dist'/old.lstrip('/')
s=p.read_text()
needle='}),(f?.inference||f?.warmup)&&(0,K.jsx)(rl,{label:`推理验收 / 预热`'
addition='}),N&&u(`poolUsage`)!=null&&(0,K.jsx)(rl,{label:`KV 缓存池占用率`,value:il(u(`poolUsage`)*100,`%`),note:`实时 · Token 槽位使用率，非显存占用`}),N&&u(`mtp`)!=null&&(0,K.jsx)(rl,{label:`草稿 Token 接受率`,value:il(u(`mtp`)*100,`%`),note:`服务启动以来 · 接受 / 已验证草稿 Token`}),(f?.inference||f?.warmup)&&(0,K.jsx)(rl,{label:`推理验收 / 预热`'
assert s.count(needle)==1 and 'label:`KV 缓存池占用率`' not in s, 'Unexpected frontend; stop without changes'
s=s.replace(needle,addition)
new='/assets/index-atom-'+hashlib.sha256(s.encode()).hexdigest()[:10]+'.js'
(root/'dist'/new.lstrip('/')).write_text(s)
html.write_text(h.replace(old,new))
print(new)
