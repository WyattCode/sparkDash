// Explicit, opt-in HTML branding. Existing ATOM defaults and archives are retained.
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const entry=fileURLToPath(new URL('../index.html',import.meta.url));
if(!process.argv.includes('--apply')){
 console.log('To enable the DGX gold favicon and launcher assets: node scripts/use-dgx-gold-brand.mjs --apply');
}else{
 const source=readFileSync(entry,'utf8');
 const updated=source
  .replace(/<meta name="theme-color"[^>]*>/,'<meta name="theme-color" content="#101312" />')
  .replace(/<link rel="manifest"[^>]*>/,'<link rel="manifest" href="/dgx-gold/manifest.webmanifest?v=gold-20261022" />')
  .replace(/<link rel="apple-touch-icon"[^>]*>/,'<link rel="apple-touch-icon" href="/dgx-gold/sparkdash-192.png?v=gold-20261022" />')
  .replace(/^[ \t]*<link rel="icon".*$/m,'  <link rel="icon" type="image/svg+xml" href="/dgx-gold/favicon.svg?v=gold-20261022" />');
 writeFileSync(entry,updated);console.log('DGX gold icon links enabled in index.html. Rebuild to deploy.');
}
