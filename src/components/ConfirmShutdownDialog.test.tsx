import {act} from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {render,flush} from '../testing/render';
import {ConfirmShutdownDialog} from './ConfirmShutdownDialog';
import {fetchPowerReadiness} from '../api/client';
vi.mock('../api/client',()=>({fetchPowerReadiness:vi.fn()}));
afterEach(()=>vi.useRealTimers());
const targets=[{id:'fixture',name:'测试节点'}];
function submitButton(){return Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='关机')!;}
async function acknowledge(){
  const input=document.querySelector('input[type=text]') as HTMLInputElement;
  act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'poweroff');input.dispatchEvent(new Event('input',{bubbles:true}));});
  act(()=>{(document.querySelector('input[type=checkbox]') as HTMLInputElement).click();});await flush();
}
it('missing dependency disables shutdown even after typed acknowledgement',async()=>{
  vi.mocked(fetchPowerReadiness).mockResolvedValue({ready:false,status:'missing-script',message:'脚本缺失',checkedAt:Date.now()});
  const confirm=vi.fn();render(<ConfirmShutdownDialog open targets={targets} onClose={()=>{}} onConfirm={confirm} title="测试" description="只读检查"/>);await flush();await acknowledge();
  expect(document.body.textContent).toContain('脚本缺失');expect(submitButton().disabled).toBe(true);act(()=>submitButton().click());expect(confirm).not.toHaveBeenCalled();
});
it('ready check still requires acknowledgement and expires after 30 seconds',async()=>{
  vi.useFakeTimers();vi.setSystemTime(100000);
  vi.mocked(fetchPowerReadiness).mockResolvedValue({ready:true,status:'ready',message:'已就绪',checkedAt:Date.now()});
  render(<ConfirmShutdownDialog open targets={targets} onClose={()=>{}} onConfirm={()=>{}} title="测试" description="检查"/>);await flush();
  expect(submitButton().disabled).toBe(true);await acknowledge();expect(submitButton().disabled).toBe(false);
  act(()=>vi.advanceTimersByTime(31000));expect(submitButton().disabled).toBe(true);
});
it('failed execution stays open with explicit error and requires recheck',async()=>{
  vi.mocked(fetchPowerReadiness).mockResolvedValue({ready:true,status:'ready',message:'已就绪',checkedAt:Date.now()});
  const close=vi.fn(),confirm=vi.fn(async()=>{throw Error('执行结果未确认');});
  render(<ConfirmShutdownDialog open targets={targets} onClose={close} onConfirm={confirm} title="测试" description="检查"/>);await flush();await acknowledge();
  act(()=>submitButton().click());await flush();expect(confirm).toHaveBeenCalledOnce();expect(close).not.toHaveBeenCalled();expect(document.querySelector('[role=alert]')?.textContent).toBe('执行结果未确认');expect(submitButton().disabled).toBe(true);
});
