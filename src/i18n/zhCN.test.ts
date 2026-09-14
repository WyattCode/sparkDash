import {expect,it} from 'vitest';
import {installZhCN,translateZhCN} from './zhCN';
it('translates only explicit complete UI messages',()=>{
  expect(translateZhCN('Settings')).toBe('设置');
  for(const text of ['PowerShell','/v1/models','namespace','Worker answer: PowerShell'])expect(translateZhCN(text)).toBe(text);
});
it('initialization and later streaming content never mutate data nodes or attributes',async()=>{
  const div=document.createElement('div');div.innerHTML='<pre>Worker</pre><code>/v1/models</code><span title="PowerShell">namespace</span>';
  document.body.append(div);const before=div.innerHTML;
  installZhCN();await Promise.resolve();expect(div.innerHTML).toBe(before);
  div.querySelector('pre')!.textContent='PowerShell Worker';await Promise.resolve();expect(div.querySelector('pre')!.textContent).toBe('PowerShell Worker');
  div.remove();
});
