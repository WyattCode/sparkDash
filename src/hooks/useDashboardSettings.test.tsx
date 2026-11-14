import {act,StrictMode} from 'react';
import {beforeEach,expect,it,vi} from 'vitest';
import {render,flush} from '../testing/render';
import {fetchSettings} from '../api/client';
import {useDashboardSettings} from './useDashboardSettings';
import type {Settings} from '../api/types';
vi.mock('../api/client',()=>({fetchSettings:vi.fn()}));
const old={density:'compact'} as Settings,newer={density:'comfortable'} as Settings;
const error=vi.fn();
function Probe(){const s=useDashboardSettings(error);return <><span>{s.settings?.density}:{String(s.settingsSettled)}</span><button onClick={()=>s.handleSettingsSaved(newer)}>save-result</button></>;}
beforeEach(()=>vi.resetAllMocks());
it('late initial success cannot replace a confirmed save',async()=>{
  let finish!:(value:Settings)=>void;vi.mocked(fetchSettings).mockReturnValue(new Promise(resolve=>{finish=resolve;}));
  const {container}=render(<Probe/>);act(()=>container.querySelector('button')!.click());await flush();
  await act(async()=>finish(old));expect(container.querySelector('span')!.textContent).toBe('comfortable:true');expect(error).not.toHaveBeenCalled();
});
it('late initial failure cannot report a stale error after save',async()=>{
  let reject!:(value:Error)=>void;vi.mocked(fetchSettings).mockReturnValue(new Promise((_,r)=>{reject=r;}));
  const {container}=render(<Probe/>);act(()=>container.querySelector('button')!.click());
  await act(async()=>reject(Error('old failure')));expect(error).not.toHaveBeenCalled();expect(container.querySelector('span')!.textContent).toBe('comfortable:true');
});
it('current initial failure still settles and reports its error',async()=>{
  vi.mocked(fetchSettings).mockRejectedValue(Error('offline'));const {container}=render(<Probe/>);await flush();
  expect(error).toHaveBeenCalledOnce();expect(container.querySelector('span')!.textContent).toBe(':true');
});
it('unmount invalidates outstanding requests',async()=>{
  let reject!:(value:Error)=>void;vi.mocked(fetchSettings).mockReturnValue(new Promise((_,r)=>{reject=r;}));
  const {root}=render(<Probe/>);act(()=>root.render(null));await act(async()=>reject(Error('late')));expect(error).not.toHaveBeenCalled();
});
it('StrictMode first request cannot overwrite the second request',async()=>{
  let finish!:(value:Settings)=>void;vi.mocked(fetchSettings).mockReturnValueOnce(new Promise(resolve=>{finish=resolve;})).mockResolvedValueOnce(newer);
  const {container}=render(<StrictMode><Probe/></StrictMode>);await flush();await act(async()=>finish(old));
  expect(container.querySelector('span')!.textContent).toBe('comfortable:true');
});
