from pathlib import Path
import re,hashlib
root=Path(__file__).resolve().parents[2];html=root/'dist/index.html';h=html.read_text();old=re.search(r'src="(/assets/[^" ]+\.js)"',h).group(1);s=(root/'dist'/old.lstrip('/')).read_text()
for a,b in [('e[t]==null?!e.available:typeof e[t]','e[t]==null?(!e.available||e.backend===`tensorfold`):typeof e[t]'),('children:de.toFixed(1)','children:e?.generationTps==null?`未采集`:de.toFixed(1)'),('children:fe.toFixed(1)','children:e?.prefillTps==null?`未采集`:fe.toFixed(1)')]:
 assert s.count(a)==1,(a,s.count(a));s=s.replace(a,b)
new='/assets/index-atom-'+hashlib.sha256(s.encode()).hexdigest()[:10]+'.js';(root/'dist'/new.lstrip('/')).write_text(s);html.write_text(h.replace(old,new));print(new)
