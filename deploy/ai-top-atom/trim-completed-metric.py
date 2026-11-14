from pathlib import Path
import re,hashlib
root=Path(__file__).resolve().parents[2];html=root/'dist/index.html';h=html.read_text();old=re.search(r'src="(/assets/[^" ]+\.js)"',h).group(1);s=(root/'dist'/old.lstrip('/')).read_text()
pattern=r'N&&u\(`completed`\)!=null&&\(0,K.jsx\)\(rl,\{label:`已完成请求`,value:[A-Za-z_$][\w$]*\(u\(`completed`\)\),note:`服务启动以来 · 响应耗时样本计数，非 HTTP 成功数`\}\),'
s,n=re.subn(pattern,'',s);assert n==1,n
new='/assets/index-atom-'+hashlib.sha256(s.encode()).hexdigest()[:10]+'.js';(root/'dist'/new.lstrip('/')).write_text(s);html.write_text(h.replace(old,new));print(new)
