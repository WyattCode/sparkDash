import {act} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
import {render} from '../../testing/render';
import {TerminalCard} from './TerminalCard';
const originalBase={label:'Worker',liveTokPerSec:0,peakTokPerSec:0,content:'',reasoning:'',error:null};
it.each(['Heartbeat timeout','Cancelled by user'])('localizes embedded error %s without altering model output',error=>{
  const html=renderToStaticMarkup(<TerminalCard {...originalBase} status="cancelled" error={error} content="Heartbeat timeout"/>);
  expect(html).not.toContain(`[错误] ${error}`);expect(html).toContain('Heartbeat timeout</pre>');
});
it.each(['streaming','completed','cancelled'])('empty %s run has explicit content',status=>{
  const html=renderToStaticMarkup(<TerminalCard {...originalBase} status={status}/>);expect(html).toContain('role="status"');
});
it('model output and label are preserved while status is localized',()=>{
  const html=renderToStaticMarkup(<TerminalCard {...originalBase} status="completed" content="PowerShell /v1/models namespace"/>);
  expect(html).toContain('PowerShell /v1/models namespace');expect(html).toContain('Worker');expect(html).toContain('已完成');
});
const base={label:'请求 01',status:'streaming',liveTokPerSec:0,peakTokPerSec:80,decodeTps:12,tokenCount:24,ttftMs:1500,content:'测试回答',reasoning:'',error:null};
it('zero live speed is zero, not the historical peak',()=>{
  const {container}=render(<TerminalCard {...base}/>);
  expect(container.textContent).toContain('当前 0.0 tok/s');expect(container.textContent).not.toContain('80');
});
it('completed speed uses final mean, not peak',()=>{
  const {container}=render(<TerminalCard {...base} status="completed"/>);
  expect(container.textContent).toContain('平均 12.0 tok/s');expect(container.textContent).toContain('首字 1.50 s');
});
it('cancelled empty output is neutral, not a red failure',()=>{
  const {container}=render(<TerminalCard {...base} status="cancelled" content="" error="用户已停止演示。"/>);
  expect(container.textContent).toContain('测试已停止，未收到输出');expect(container.querySelector('.showcase-term__error')).toBeNull();
});
it('reasoning can be collapsed and result copy is explicit',()=>{
  const copy=vi.fn();const {container}=render(<TerminalCard {...base} reasoning="思考内容" onCopy={copy}/>);
  act(()=>container.querySelector<HTMLButtonElement>('.showcase-term__reasoning-toggle')!.click());
  expect(container.querySelector('.showcase-term__reasoning-text')).toBeNull();
  act(()=>container.querySelector<HTMLButtonElement>('.showcase-term__copy')!.click());expect(copy).toHaveBeenCalledOnce();
});
it.each(['completed','streaming'])('scroll follows only live output (%s)',status=>{
  const {container,root}=render(<TerminalCard {...base} status={status}/>);
  const body=container.querySelector<HTMLElement>('.showcase-term__body')!;
  Object.defineProperty(body,'scrollHeight',{configurable:true,value:1000});
  act(()=>root.render(<TerminalCard {...base} status={status} content="更新后的内容"/>));
  expect(body.scrollTop).toBe(status==='streaming'?1000:0);
});
