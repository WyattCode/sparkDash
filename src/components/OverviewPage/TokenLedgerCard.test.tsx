import {act} from 'react';
import {it,expect,vi} from 'vitest';
import {render,flush} from '../../testing/render';
import {apiFetch} from '../../api/client';
import {TokenLedgerCard} from './TokenLedgerCard';
vi.mock('../../api/client',()=>({apiFetch:vi.fn()}));
async function open(){const view=render(<TokenLedgerCard/>);act(()=>{const el=view.container.querySelector('details')!;el.open=true;el.dispatchEvent(new Event('toggle'));});await flush();return view;}
it('does not fetch until opened and explains an empty ledger',async()=>{
  vi.mocked(apiFetch).mockResolvedValue({rows:[],persistenceError:null});
  const view=render(<TokenLedgerCard/>);expect(view.container.textContent).toBe('模型 Token 台账');
  act(()=>{const el=view.container.querySelector('details')!;el.open=true;el.dispatchEvent(new Event('toggle'));});await flush();
  expect(view.container.textContent).toContain('首次采样仅建立基线');
});
it('shows integer counters, unknown cache and capitalized display names',async()=>{
  vi.mocked(apiFetch).mockResolvedValue({rows:[{sparkId:'spark-a',port:8888,modelId:'test-model',promptTokens:200,cachedTokens:null,completionTokens:100}],persistenceError:null});
  const view=await open();expect(view.container.textContent).toContain('Spark-a');expect(view.container.textContent).toContain('—');
  expect([...view.container.querySelectorAll('dd')].map(n=>n.textContent)).toEqual(['200','—','100']);
  expect(view.container.textContent).toContain('缓存命中是输入的一部分');
});
it('reports request failure instead of rendering fake zero totals',async()=>{
  vi.mocked(apiFetch).mockRejectedValue(Error('离线'));const view=await open();
  expect(view.container.querySelector('[role=alert]')?.textContent).toContain('离线');expect(view.container.querySelectorAll('dd')).toHaveLength(0);
});
