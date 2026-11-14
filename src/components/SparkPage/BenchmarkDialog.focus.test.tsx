import { act } from 'react';
import { expect, it, vi } from 'vitest';
import { render, flush } from '../../testing/render';
import { BenchmarkDialog } from './BenchmarkDialog';
import { PrefillBenchDialog } from './PrefillBenchDialog';
import * as api from '../../api/client';

vi.mock('../../hooks/useModalPresence',()=>({useModalPresence:(open:boolean)=>({mounted:open,visible:open})}));
vi.mock('../../api/client',()=>({
  listDecodeBench:vi.fn(async()=>({active:null,last:null})),listPrefillBench:vi.fn(async()=>({active:null,last:null})),
  startDecodeBench:vi.fn(),cancelDecodeBench:vi.fn(),clearDecodeBenchHistory:vi.fn(),getDecodeBench:vi.fn(),
  startPrefillBench:vi.fn(),cancelPrefillBench:vi.fn(),clearPrefillBenchHistory:vi.fn(),getPrefillBench:vi.fn(),
}));
for (const kind of ['decode','prefill']) it(`${kind} traps Tab in the dialog without starting a job`,async()=>{
  const props={open:true,onClose:vi.fn(),sparkId:'fixture',llmPort:8888,modelId:'test-model'};
  render(kind==='decode'?<BenchmarkDialog {...props}/>:<PrefillBenchDialog {...props} contextLength={131072}/>);
  await flush();
  const dialog=document.querySelector('[role=dialog]')!;
  expect(dialog.contains(document.activeElement)).toBe(true);
  expect(document.querySelector<HTMLButtonElement>('.bench-overlay__scrim')?.tabIndex).toBe(-1);
  const first=dialog.querySelector<HTMLButtonElement>('.bench-sheet__close')!;
  act(()=>first.focus());
  act(()=>first.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true})));
  expect(document.activeElement?.textContent).toBe('运行基准测试');
  act(()=>document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true})));
  expect(document.activeElement).toBe(first);
  expect(api.startDecodeBench).not.toHaveBeenCalled();expect(api.startPrefillBench).not.toHaveBeenCalled();
});
