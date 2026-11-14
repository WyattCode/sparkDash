import { act } from 'react';
import { expect, it, vi } from 'vitest';
import { render } from '../../testing/render';
import { makeSpark } from '../../testing/fixtures';
import { OverviewPage } from './OverviewPage';
vi.mock('./OperationsPanel',()=>({OperationsPanel:({view}:{view:string})=>view==='summary'?null:<div data-operations-view={view}/> }));
it('does not stack the old full console, comparison and ledger below overview',()=>{
 const {container}=render(<OverviewPage sparks={[makeSpark()]}/>);
 expect(container.querySelector('.cockpit-hero')).not.toBeNull();expect(container.querySelector('.comparison-band')).toBeNull();expect(container.querySelector('[data-operations-view]')).toBeNull();expect(container.textContent).not.toContain('模型 Token 台账');
});
it('shows cards or comparison, never both; node search works without overview preference',()=>{
 const {container}=render(<OverviewPage workspace="nodes" sparks={[makeSpark('alpha'),makeSpark('beta')]}/>);
 expect(container.querySelectorAll('.cockpit-node')).toHaveLength(2);
 const compare=[...container.querySelectorAll('button')].find(e=>e.textContent==='指标对比')!;
 act(()=>compare.click());expect(container.querySelector('.cockpit-node-rail')).toBeNull();expect(container.querySelector('.comparison-band')).not.toBeNull();
});
it('gives model service one dedicated surface without repeating overview cards',()=>{
 const {container}=render(<OverviewPage workspace="service" sparks={[makeSpark()]}/>);
 expect(container.querySelector('[data-operations-view="service"]')).not.toBeNull();expect(container.querySelector('.cockpit-hero')).toBeNull();expect(container.querySelector('.cockpit-node')).toBeNull();
});
it('groups analysis and diagnostics without rendering the unrelated service grid',()=>{
 let view=render(<OverviewPage workspace="analysis" sparks={[makeSpark()]}/>);expect(view.container.querySelector('[data-operations-view="history"]')).not.toBeNull();
 view=render(<OverviewPage workspace="diagnostics" sparks={[makeSpark()]}/>);expect(view.container.querySelector('[data-operations-view="network"]')).not.toBeNull();
});
it('places node controls inside the node heading and preserves them when inventory is empty',()=>{
 const controls=<div data-node-controls/>;
 let view=render(<OverviewPage workspace="nodes" sparks={[makeSpark()]} nodeControls={controls}/>);
 expect(view.container.querySelector('.overview-heading [data-node-controls]')).not.toBeNull();
 view=render(<OverviewPage workspace="overview" sparks={[makeSpark()]} nodeControls={controls}/>);
 expect(view.container.querySelector('[data-node-controls]')).toBeNull();
 view=render(<OverviewPage workspace="nodes" sparks={[]} nodeControls={controls}/>);
 expect(view.container.querySelector('[data-node-controls]')).not.toBeNull();
});
it('recovers from an empty status filter in both node views',()=>{
 for(const compare of [false,true]){
  const {container}=render(<OverviewPage workspace="nodes" sparks={[makeSpark('alpha')]}/>);
  if(compare)act(()=>[...container.querySelectorAll('button')].find(e=>e.textContent==='指标对比')!.click());
  const select=container.querySelector<HTMLSelectElement>('[aria-label="按状态筛选节点"]')!;
  act(()=>{select.value='offline';select.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(container.textContent).toContain('没有符合当前筛选条件');
  act(()=>[...container.querySelectorAll('button')].find(e=>e.textContent==='清除筛选')!.click());
  expect(select.value).toBe('all');
  expect(container.querySelector(compare?'.comparison-band':'.cockpit-node')).not.toBeNull();
 }
});
