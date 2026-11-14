import {act} from 'react';
import {expect,it,vi} from 'vitest';
import {render,flush} from '../testing/render';
import {SettingsDialog} from './SettingsDialog';
import {fetchSettings,updateSettings} from '../api/client';
import type {Settings} from '../api/types';
vi.mock('../api/client',()=>({fetchSettings:vi.fn(),updateSettings:vi.fn()}));
const settings:Settings={pollIntervalMs:2000,defaultLlmPort:8888,autoHideOffline:false,hideWorkers:false,temperatureUnit:'celsius',benchDebugTraces:false,density:'compact',showFleetEnergy:false,showFleetExceptions:false,showOverviewSearch:false,benchShareImage:false};
function changePort(value:string){act(()=>{const input=document.querySelector('input[type=number]')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});}
function button(text:string){return [...document.querySelectorAll('button')].find(b=>b.textContent===text)!;}
it('invalid ports block save with accessible explanation',async()=>{
  vi.mocked(fetchSettings).mockResolvedValue(settings);
  render(<SettingsDialog open onClose={()=>{}} onSaved={()=>{}}/>);await flush();changePort('65536');
  expect(document.querySelector('[role=dialog][aria-modal=true]')).not.toBeNull();expect(document.querySelector('[role=alert]')?.textContent).toContain('1–65535');expect(button('保存').disabled).toBe(true);expect(updateSettings).not.toHaveBeenCalled();
});
it('pending save blocks editing and Escape dismissal',async()=>{
  vi.mocked(fetchSettings).mockResolvedValue(settings);
  let finish!:(s:Settings)=>void;
  vi.mocked(updateSettings).mockReturnValue(new Promise(resolve=>{finish=resolve;}));
  const close=vi.fn();render(<SettingsDialog open onClose={close} onSaved={()=>{}}/>);await flush();changePort('8889');act(()=>button('保存').click());await flush();
  expect(document.querySelector('fieldset')?.disabled).toBe(true);act(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})));expect(close).not.toHaveBeenCalled();
  await act(async()=>finish({...settings,defaultLlmPort:8889}));expect(close).toHaveBeenCalledOnce();
});
it('failed loading has a retry path',async()=>{
  vi.mocked(fetchSettings).mockRejectedValueOnce(Error('离线')).mockResolvedValueOnce(settings);
  render(<SettingsDialog open onClose={()=>{}} onSaved={()=>{}}/>);await flush();expect(document.querySelector('[role=alert]')?.textContent).toBe('离线');
  act(()=>button('重新加载设置').click());await flush();expect(document.querySelector('input[type=number]')).not.toBeNull();expect(document.querySelector('[role=alert]')).toBeNull();
});
it('all eight labelled switches update local state without writing on cancel',async()=>{
  vi.mocked(fetchSettings).mockResolvedValue(settings);
  const close=vi.fn();
  render(<SettingsDialog open onClose={close} onSaved={()=>{}}/>);await flush();
  const switches=[...document.querySelectorAll<HTMLButtonElement>('[role=switch]')];
  expect(switches).toHaveLength(8);
  for(const control of switches){
    expect(document.getElementById(control.getAttribute('aria-labelledby')!)?.textContent).toBeTruthy();
    expect(document.getElementById(control.getAttribute('aria-describedby')!)?.textContent).toBeTruthy();
    const before=control.getAttribute('aria-checked');
    act(()=>control.click());
    expect(control.getAttribute('aria-checked')).toBe(before==='true'?'false':'true');
  }
  expect(button('保存').disabled).toBe(false);
  act(()=>button('取消').click());
  expect(close).toHaveBeenCalledOnce();
  expect(updateSettings).not.toHaveBeenCalled();
});
it('sends only edited fields and preserves concurrent unrelated settings',async()=>{
  vi.mocked(fetchSettings).mockResolvedValue(settings);
  const remote={...settings,pollIntervalMs:10000,defaultLlmPort:9000};
  vi.mocked(updateSettings).mockResolvedValue(remote);
  const saved=vi.fn();
  render(<SettingsDialog open onClose={()=>{}} onSaved={saved}/>);await flush();
  changePort('9000');act(()=>button('保存').click());await flush();
  expect(updateSettings).toHaveBeenCalledExactlyOnceWith({defaultLlmPort:9000});
  expect(saved).toHaveBeenCalledExactlyOnceWith(remote);
});
it('reverting changes disables save again',async()=>{
  vi.mocked(fetchSettings).mockResolvedValue(settings);
  render(<SettingsDialog open onClose={()=>{}} onSaved={()=>{}}/>);await flush();
  changePort('9000');expect(button('保存').disabled).toBe(false);
  changePort('8888');expect(button('保存').disabled).toBe(true);
  const toggle=document.querySelector<HTMLButtonElement>('[role=switch]')!;
  act(()=>toggle.click());expect(button('保存').disabled).toBe(false);
  act(()=>toggle.click());expect(button('保存').disabled).toBe(true);
  expect(updateSettings).not.toHaveBeenCalled();
});
it('saves every preference explicitly and exposes segmented selection',async()=>{
  vi.mocked(fetchSettings).mockResolvedValue(settings);
  vi.mocked(updateSettings).mockImplementation(async value=>({...settings,...value}));
  const saved=vi.fn();
  render(<SettingsDialog open onClose={()=>{}} onSaved={saved}/>);await flush();
  expect(button('2 秒').getAttribute('aria-pressed')).toBe('true');
  expect(button('保存').disabled).toBe(true);
  act(()=>button('5 秒').click());act(()=>button('°F').click());changePort('9000');
  for(const control of document.querySelectorAll<HTMLButtonElement>('[role=switch]'))act(()=>control.click());
  act(()=>button('保存').click());await flush();
  const expected={...settings,pollIntervalMs:5000,defaultLlmPort:9000,temperatureUnit:'fahrenheit',
    autoHideOffline:true,hideWorkers:true,showOverviewSearch:true,showFleetEnergy:true,
    showFleetExceptions:true,benchShareImage:true,benchDebugTraces:true,density:'comfortable'};
  expect(updateSettings).toHaveBeenCalledExactlyOnceWith(expected);
  expect(saved).toHaveBeenCalledExactlyOnceWith(expected);
});
