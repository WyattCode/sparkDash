import {act} from 'react';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {render,flush} from '../../testing/render';
import {apiFetch} from '../../api/client';
import {RocePanel} from './RocePanel';
vi.mock('../../api/client',()=>({apiFetch:vi.fn()}));
beforeEach(()=>{vi.useFakeTimers();vi.mocked(apiFetch).mockReset().mockResolvedValue({available:true,stale:false,sampledAt:1000,devices:[{name:'fixture-hca',netdev:'fixture-net',active:true,physState:'LinkUp',rateGbps:200,mtu:9000}]} as never);});
afterEach(()=>vi.useRealTimers());
const toggle=(c:HTMLElement)=>c.querySelector('button')!;
it('does not sample while collapsed and stops when closed',async()=>{
  const {container}=render(<RocePanel sparkId="fixture" online/>);
  expect(apiFetch).not.toHaveBeenCalled();
  act(()=>toggle(container).click());await flush();
  expect(apiFetch).toHaveBeenCalledOnce();expect(container.textContent).toContain('1 / 1 链路就绪');
  expect(container.textContent).toContain('fixture-net');expect(container.textContent).toContain('—');
  act(()=>toggle(container).click());await act(async()=>{await vi.advanceTimersByTimeAsync(20000);});
  expect(apiFetch).toHaveBeenCalledOnce();
});
it('an offline node does not trigger SSH collection',async()=>{
  const {container}=render(<RocePanel sparkId="fixture" online={false}/>);
  act(()=>toggle(container).click());await flush();
  expect(apiFetch).not.toHaveBeenCalled();expect(container.textContent).toContain('节点离线');
});
it('late results after closing cannot repopulate the collapsed panel',async()=>{
  let done!:(v:unknown)=>void;vi.mocked(apiFetch).mockReturnValue(new Promise(resolve=>{done=resolve;}) as never);
  const {container}=render(<RocePanel sparkId="fixture" online/>);
  act(()=>toggle(container).click());await flush();act(()=>toggle(container).click());
  await act(async()=>done({available:true,devices:[{name:'old-node'}]}));
  expect(container.textContent).not.toContain('old-node');expect(toggle(container).getAttribute('aria-expanded')).toBe('false');
});
