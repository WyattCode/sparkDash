import {act} from 'react';
import {expect,it,vi} from 'vitest';
import {render} from '../testing/render';
import {makeSpark} from '../testing/fixtures';
import {NodeNavigation} from './NodeNavigation';

it('keeps selection and node management local without a second tab bar',()=>{
  const onSelect=vi.fn(),onAdd=vi.fn(),onEdit=vi.fn();
  const {container}=render(<NodeNavigation sparks={[makeSpark('a'),makeSpark('b')]} activeId="a" onSelect={onSelect} onAdd={onAdd} onEdit={onEdit} onReorder={vi.fn()}/>);
  expect(container.querySelector('[role=tablist]')).toBeNull();
  const select=container.querySelector('select')!;
  act(()=>{select.value='';select.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(onSelect).toHaveBeenCalledWith(null);
  const buttons=[...container.querySelectorAll('button')];
  act(()=>buttons.find(b=>b.textContent==='添加节点')!.click());
  act(()=>buttons.find(b=>b.textContent==='编辑节点')!.click());
  expect(onAdd).toHaveBeenCalledOnce();expect(onEdit).toHaveBeenCalledWith('a');
});

it('reorders the complete node list and disables boundary moves',async()=>{
  const onReorder=vi.fn();
  const {container}=render(<NodeNavigation sparks={[makeSpark('a'),makeSpark('b')]} activeId={null} onSelect={vi.fn()} onAdd={vi.fn()} onEdit={vi.fn()} onReorder={onReorder}/>);
  const arrows=[...container.querySelectorAll<HTMLButtonElement>('.node-order button')];
  expect(arrows[0].disabled).toBe(true);expect(arrows[3].disabled).toBe(true);
  await act(async()=>arrows[1].click());
  expect(onReorder).toHaveBeenCalledWith(['b','a']);
});

it('dismisses management when clicking outside without changing any configuration',()=>{
  const onReorder=vi.fn();
  const {container}=render(<NodeNavigation sparks={[makeSpark('a')]} activeId="a" onSelect={vi.fn()} onAdd={vi.fn()} onEdit={vi.fn()} onReorder={onReorder}/>);
  const menu=container.querySelector<HTMLDetailsElement>('.node-manage')!;
  menu.open=true;
  act(()=>document.body.dispatchEvent(new Event('pointerdown',{bubbles:true})));
  expect(menu.open).toBe(false);expect(onReorder).not.toHaveBeenCalled();
});
it('Escape closes the innermost disclosure and restores visible keyboard focus',()=>{
 const {container}=render(<NodeNavigation sparks={[makeSpark('a'),makeSpark('b')]} activeId="a" onSelect={vi.fn()} onAdd={vi.fn()} onEdit={vi.fn()} onReorder={vi.fn()}/>);
 const manage=container.querySelector<HTMLDetailsElement>('.node-manage')!,order=container.querySelector<HTMLDetailsElement>('.node-order')!;
 manage.open=true;order.open=true;
 const button=order.querySelector<HTMLButtonElement>('button:not(:disabled)')!;button.focus();
 act(()=>button.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 expect(order.open).toBe(false);expect(manage.open).toBe(true);
 expect(document.activeElement).toBe(order.querySelector('summary'));
 act(()=>document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 expect(manage.open).toBe(false);expect(document.activeElement).toBe(manage.querySelector('summary'));
});
