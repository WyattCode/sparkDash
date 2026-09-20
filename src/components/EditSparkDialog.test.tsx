import { act } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { render, flush } from '../testing/render';
import { EditSparkDialog } from './EditSparkDialog';
import { deleteSpark, fetchSparks, setSparkPassword, testSpark, testSparkConfig, updateSpark } from '../api/client';
import type { SparkConfig, SparkTestResponse } from '../api/types';
vi.mock('../api/client', () => ({deleteSpark:vi.fn(),fetchSparks:vi.fn(),setSparkPassword:vi.fn(),testSpark:vi.fn(),testSparkConfig:vi.fn(),updateSpark:vi.fn()}));
const node: SparkConfig = {id:'head-a',name:'主节点',lanIp:'192.168.1.1',isLocal:false,ssh:{host:'192.168.1.1',user:'fixture',auth:'pass',hasPassword:true},comfyMonitoring:true,comfyPort:8188};
const result = {ok:true,capabilities:[]} as unknown as SparkTestResponse;
const button = (text:string) => [...document.querySelectorAll('button')].find(b=>b.textContent===text)!;
function input(selector:string,value:string){act(()=>{const el=document.querySelector(selector)!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));});}
beforeEach(()=>{vi.resetAllMocks();vi.mocked(fetchSparks).mockResolvedValue({sparks:[node]});vi.mocked(testSpark).mockResolvedValue(result);vi.mocked(testSparkConfig).mockResolvedValue(result);});
async function open(close=vi.fn()){const rendered=render(<EditSparkDialog open sparkId={node.id} onClose={close} onSaved={()=>{}}/>);await flush();return rendered;}

it('loading failure retries and invalid port blocks writes',async()=>{
  vi.mocked(fetchSparks).mockRejectedValueOnce(Error('读取失败')).mockResolvedValueOnce({sparks:[node]});
  await open();expect(document.querySelector('[role=alert]')?.textContent).toBe('读取失败');
  act(()=>button('重新加载节点').click());await flush();
  input('[aria-label="ComfyUI 端口"]','65536');expect(button('保存').disabled).toBe(true);expect(button('测试连接').disabled).toBe(true);
  expect(document.querySelector('[aria-invalid=true]')).not.toBeNull();expect(updateSpark).not.toHaveBeenCalled();
});
it('test uses a draft password without persisting it; edits clear old results',async()=>{
  await open();input('input[type=password]','new-test-secret');act(()=>button('测试连接').click());await flush();
  expect(setSparkPassword).not.toHaveBeenCalled();expect(updateSpark).not.toHaveBeenCalled();
  expect(vi.mocked(testSparkConfig).mock.calls[0][0].ssh.password).toBe('new-test-secret');
  expect(document.querySelector('[role=status]')).not.toBeNull();input('[aria-label="ComfyUI 端口"]','9000');expect(document.querySelector('[role=status]')).toBeNull();
});
it('changed password-auth target requires a fresh password, not saved secret forwarding',async()=>{
  await open();input('[aria-label="ComfyUI 端口"]','9000');act(()=>button('测试连接').click());await flush();
  expect(document.querySelector('[role=alert]')?.textContent).toContain('重新输入 SSH 密码');expect(testSpark).not.toHaveBeenCalled();expect(testSparkConfig).not.toHaveBeenCalled();
});
it('partial save reports persisted password and preserves config draft',async()=>{
  vi.mocked(setSparkPassword).mockResolvedValue({} as never);vi.mocked(updateSpark).mockRejectedValue(Error('配置保存失败'));
  const close=vi.fn();await open(close);input('input[type=password]','new-secret');act(()=>button('保存').click());await flush();
  expect(document.querySelector('[role=status]')?.textContent).toContain('密码也已更新');expect(document.querySelector('[role=alert]')?.textContent).toContain('配置保存失败');
  expect((document.querySelector('input[type=password]') as HTMLInputElement).value).toBe('');expect(close).not.toHaveBeenCalled();
});
it('in-flight save blocks double submit, close and test; focus stays inside',async()=>{
  let finish!:(v:never)=>void;vi.mocked(updateSpark).mockReturnValue(new Promise(r=>{finish=r;}));
  const close=vi.fn();await open(close);act(()=>{button('保存').click();button('保存').click();});await flush();
  expect(updateSpark).toHaveBeenCalledTimes(1);expect(button('取消').disabled).toBe(true);expect(button('测试连接').disabled).toBe(true);expect(button('移除').textContent).toBe('移除');
  act(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})));expect(close).not.toHaveBeenCalled();
  act(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',cancelable:true})));expect(document.activeElement?.getAttribute('role')).toBe('dialog');
  await act(async()=>finish({} as never));expect(close).toHaveBeenCalledOnce();
});
it('switching nodes ignores late test results and callbacks',async()=>{
  let finish!:(v:SparkTestResponse)=>void;vi.mocked(testSpark).mockReturnValue(new Promise(r=>{finish=r;}));
  const close=vi.fn();const {root}=await open(close);act(()=>button('测试连接').click());
  const worker={...node,id:'worker-b',name:'工作节点'};vi.mocked(fetchSparks).mockResolvedValue({sparks:[worker]});
  act(()=>root.render(<EditSparkDialog open sparkId={worker.id} onClose={close} onSaved={()=>{}}/>));await flush();
  await act(async()=>finish(result));expect(document.querySelector('[role=status]')).toBeNull();expect(close).not.toHaveBeenCalled();
  expect((document.querySelector('input[type=text]') as HTMLInputElement).value).toBe('工作节点');
});
it('removal needs exact ID; failure clears confirmation and offers reload',async()=>{
  vi.mocked(deleteSpark).mockRejectedValue(Error('操作结果未确认'));const close=vi.fn();await open(close);
  act(()=>button('移除').click());expect(button('确认移除').disabled).toBe(true);expect(document.body.textContent).toContain('不会关机或停止模型');
  input('[aria-label="移除确认节点 ID"]','wrong');expect(button('确认移除').disabled).toBe(true);expect(deleteSpark).not.toHaveBeenCalled();
  input('[aria-label="移除确认节点 ID"]',node.id);act(()=>button('确认移除').click());await flush();
  expect(deleteSpark).toHaveBeenCalledWith(node.id);expect(close).not.toHaveBeenCalled();expect(button('确认移除').disabled).toBe(true);
  expect(button('放弃草稿并重新加载')).toBeDefined();
});
it('successful removal calls parent once and never updates configuration',async()=>{
  vi.mocked(deleteSpark).mockResolvedValue({success:true,removed:node});const close=vi.fn(),deleted=vi.fn();
  render(<EditSparkDialog open sparkId={node.id} onClose={close} onSaved={()=>{}} onDeleted={deleted}/>);await flush();act(()=>button('移除').click());input('[aria-label="移除确认节点 ID"]',node.id);
  act(()=>button('确认移除').click());await flush();expect(deleted).toHaveBeenCalledExactlyOnceWith(node.id);expect(close).toHaveBeenCalledOnce();expect(updateSpark).not.toHaveBeenCalled();
});
it('late save after switching nodes cannot close the new dialog',async()=>{
  let finish!:(v:never)=>void;vi.mocked(updateSpark).mockReturnValue(new Promise(r=>{finish=r;}));
  const close=vi.fn(),saved=vi.fn();const {root}=render(<EditSparkDialog open sparkId={node.id} onClose={close} onSaved={saved}/>);await flush();act(()=>button('保存').click());
  const worker={...node,id:'worker-b',name:'工作节点'};vi.mocked(fetchSparks).mockResolvedValue({sparks:[worker]});
  act(()=>root.render(<EditSparkDialog open sparkId={worker.id} onClose={close} onSaved={saved}/>));await flush();await act(async()=>finish({} as never));
  expect(close).not.toHaveBeenCalled();expect(saved).not.toHaveBeenCalled();expect((document.querySelector('input[type=text]') as HTMLInputElement).value).toBe('工作节点');
});
it('late initial fetch does not replace the next node',async()=>{
  let finish!:(v:{sparks:SparkConfig[]})=>void;vi.mocked(fetchSparks).mockReturnValueOnce(new Promise(r=>{finish=r;}));
  const {root}=await open();const worker={...node,id:'worker-b',name:'工作节点'};vi.mocked(fetchSparks).mockResolvedValue({sparks:[worker]});
  act(()=>root.render(<EditSparkDialog open sparkId={worker.id} onClose={()=>{}} onSaved={()=>{}}/>));await flush();await act(async()=>finish({sparks:[node]}));
  expect((document.querySelector('input[type=text]') as HTMLInputElement).value).toBe('工作节点');
});
it('pending deletion locks confirmation and closes only after success',async()=>{
  let finish!:(v:never)=>void;vi.mocked(deleteSpark).mockReturnValue(new Promise(r=>{finish=r;}));
  const close=vi.fn();await open(close);act(()=>button('移除').click());input('[aria-label="移除确认节点 ID"]',node.id);act(()=>button('确认移除').click());await flush();
  expect(button('正在移除…').disabled).toBe(true);expect(button('返回编辑').disabled).toBe(true);expect(button('保存').disabled).toBe(true);
  act(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})));expect(close).not.toHaveBeenCalled();
  await act(async()=>finish({} as never));expect(close).toHaveBeenCalledOnce();
});
