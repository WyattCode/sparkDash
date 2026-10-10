"""Patch the preserved hero; source counterpart: DeviceSilhouette.tsx."""
from pathlib import Path
import re, hashlib
root=Path(__file__).resolve().parents[2]
html=root/'dist/index.html'; h=html.read_text()
old=re.search(r'src="(/assets/[^" ]+\.js)"',h).group(1)
p=root/'dist'/old.lstrip('/'); s=p.read_text()
needle='(0,K.jsxs)(`div`,{className:`dgx-hero__silhouette`,"aria-hidden":`true`,children:[(0,K.jsx)(`i`,{}),(0,K.jsx)(`i`,{}),(0,K.jsx)(`i`,{}),(0,K.jsx)(`i`,{})]})'
replacement='(0,K.jsx)(`div`,{className:`dgx-hero__silhouette`,"aria-hidden":`true`,"data-device-count":o,style:{"--device-columns":Math.min(o,4)},children:e.filter(e=>e.online).map((e,t)=>(0,K.jsx)(`i`,{"data-node-id":e.id,style:{"--device-column":t%4,"--device-row":Math.floor(t/4),animationDelay:`${.16+t*.08}s`}},e.id))})'
assert s.count(needle)==1,'Unexpected hero: abort'
s=s.replace(needle,replacement)
new='/assets/index-atom-'+hashlib.sha256(s.encode()).hexdigest()[:10]+'.js'
(root/'dist'/new.lstrip('/')).write_text(s)
css=(root/'public/atom-theme.css').read_bytes(); (root/'dist/atom-theme.css').write_bytes(css)
h=h.replace(old,new);h=re.sub(r'/atom-theme.css\?v=[^" ]+', '/atom-theme.css?v='+hashlib.sha256(css).hexdigest()[:10],h)
html.write_text(h);print(new)
