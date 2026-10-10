from pathlib import Path
import re,hashlib
root=Path(__file__).resolve().parents[2];html=root/'dist/index.html';h=html.read_text();old=re.search(r'src="(/assets/[^" ]+\.js)"',h).group(1);s=(root/'dist'/old.lstrip('/')).read_text()
for key,metric in [('generationTps','tps'),('prefillTps','prefill')]:
 a=f'P(`${{r.id}}:llm${{s}}.{metric}`,a.{key},t)';b=f'(typeof a.{key}===`number`&&Number.isFinite(a.{key})&&a.{key}>=0)&&'+a
 assert s.count(a)==1;s=s.replace(a,b)
new='/assets/index-atom-'+hashlib.sha256(s.encode()).hexdigest()[:10]+'.js';(root/'dist'/new.lstrip('/')).write_text(s);html.write_text(h.replace(old,new));print(new)
