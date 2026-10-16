from pathlib import Path
import re,hashlib
root=Path(__file__).resolve().parents[2];html=root/'dist/index.html';h=html.read_text();old=re.search(r'src="(/assets/[^" ]+\.js)"',h).group(1);s=(root/'dist'/old.lstrip('/')).read_text()
needle='N&&u(`kv`)!=null&&(0,K.jsx)(rl,{label:`流上下文占用率`,value:il(u(`kv`)*100,`%`),note:`实时 · 单流缓存 / 上下文窗口，非全局缓存池`}),'
assert s.count(needle)==1;s=s.replace(needle,'')
new='/assets/index-atom-'+hashlib.sha256(s.encode()).hexdigest()[:10]+'.js';(root/'dist'/new.lstrip('/')).write_text(s);html.write_text(h.replace(old,new));print(new)
