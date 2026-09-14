import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {TerminalCard} from './TerminalCard';
const base={label:'Worker',liveTokPerSec:0,peakTokPerSec:0,content:'',reasoning:'',error:null};
it.each(['Heartbeat timeout','Cancelled by user'])('localizes embedded error %s without altering model output',error=>{
  const html=renderToStaticMarkup(<TerminalCard {...base} status="cancelled" error={error} content="Heartbeat timeout"/>);
  expect(html).not.toContain(`[错误] ${error}`);expect(html).toContain('Heartbeat timeout</pre>');
});
it.each(['streaming','completed','cancelled'])('empty %s run has explicit content',status=>{
  const html=renderToStaticMarkup(<TerminalCard {...base} status={status}/>);expect(html).toContain('role="status"');
});
it('model output and label are preserved while status is localized',()=>{
  const html=renderToStaticMarkup(<TerminalCard {...base} status="completed" content="PowerShell /v1/models namespace"/>);
  expect(html).toContain('PowerShell /v1/models namespace');expect(html).toContain('Worker');expect(html).toContain('已完成');
});
