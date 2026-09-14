import {act} from 'react';
import {expect,it,vi} from 'vitest';
import {render,flush} from '../testing/render';
import {SettingsDialog} from './SettingsDialog';
import {fetchSettings,updateSettings} from '../api/client';
import type {Settings} from '../api/types';
vi.mock('../api/client',()=>({fetchSettings:vi.fn(),updateSettings:vi.fn()}));
const settings:Settings={pollIntervalMs:2000,defaultLlmPort:8888,autoHideOffline:false,hideWorkers:false,temperatureUnit:'celsius',benchDebugTraces:false,density:'compact',showFleetEnergy:false,showFleetExceptions:false,showOverviewSearch:false};
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
