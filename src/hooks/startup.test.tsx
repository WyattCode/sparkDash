import {act} from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import html from '../../index.html?raw';
import {render} from '../testing/render';
import {activeIdFromPath,parsePath} from './useRoute';
import {useStartupPending} from './useStartupPending';
import {OVERVIEW_ID} from '../constants';
function Probe({snapshot=false,settings=false}:{snapshot?:boolean;settings?:boolean}){return <span>{useStartupPending(snapshot,settings)?'pending':'ready'}</span>;}
afterEach(()=>vi.useRealTimers());
it('initial path is resolved synchronously, including encoded IDs',()=>{
  expect(activeIdFromPath('/spark/worker-b')).toBe('worker-b');
  expect(activeIdFromPath('/spark/%E4%B8%BB%E6%9C%BA')).toBe('主机');
  expect(activeIdFromPath('/spark/%invalid')).toBe(OVERVIEW_ID);
  expect(activeIdFromPath('/')).toBe(OVERVIEW_ID);
});
it('malformed showcase IDs safely fall back instead of throwing',()=>{
  for(const path of ['/showcase/%invalid','/showcase/%E0%A4%A','/showcase/%'])expect(parsePath(path)).toEqual({mode:'app',showcaseSparkId:null});
  expect(parsePath('/showcase/%E4%B8%BB%E6%9C%BA')).toEqual({mode:'showcase',showcaseSparkId:'主机'});
});
it('startup waits for both sources, not an empty snapshot length',()=>{
  const {root,container}=render(<Probe/>);expect(container.textContent).toBe('pending');
  act(()=>root.render(<Probe snapshot/>));expect(container.textContent).toBe('pending');
  act(()=>root.render(<Probe snapshot settings/>));expect(container.textContent).toBe('ready');
});
it('failed startup becomes visible after five seconds rather than hiding errors forever',()=>{
  vi.useFakeTimers();const {container}=render(<Probe/>);
  act(()=>vi.advanceTimersByTime(4999));expect(container.textContent).toBe('pending');
  act(()=>vi.advanceTimersByTime(1));expect(container.textContent).toBe('ready');
});
it('HTML restores validated theme and density before mounting React',()=>{
  const source=html.match(/<script>([\s\S]*?)<\/script>/)![1];
  const run=new Function('localStorage','document','window',source);
  const doc={documentElement:{dataset:{theme:'dark',density:'compact'}},querySelector:()=>({setAttribute:vi.fn()})};
  const win={matchMedia:()=>({matches:true,addEventListener:vi.fn()})};
  run({getItem:(key:string)=>key==='sparkdash-theme'?'white':'comfortable'},doc,win);
  expect(doc.documentElement.dataset).toEqual({theme:'white',density:'comfortable'});
  run({getItem:()=>'<invalid>'},doc,win);expect(doc.documentElement.dataset.theme).toBe('white');
  expect(()=>run({getItem:()=>{throw Error('disabled');}},doc,win)).not.toThrow();
  expect(html.indexOf('dataset.theme')).toBeLessThan(html.indexOf('/src/main.tsx'));
});
it('outer-screen zoom restriction follows viewport changes without changing theme',()=>{
  const run=new Function('localStorage','document','window',html.match(/<script>([\s\S]*?)<\/script>/)![1]);
  const setAttribute=vi.fn();let update=()=>{};
  const media={matches:true,addEventListener:(_event:string,cb:()=>void)=>{update=cb;}};
  run({getItem:()=>null},{documentElement:{dataset:{}},querySelector:()=>({setAttribute})},{matchMedia:()=>media});
  expect(setAttribute).toHaveBeenLastCalledWith('content',expect.stringContaining('user-scalable=no'));
  media.matches=false;update();
  expect(setAttribute).toHaveBeenLastCalledWith('content','width=device-width, initial-scale=1.0, viewport-fit=cover');
});
