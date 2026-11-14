import { act, useState } from 'react';
import { createPortal } from 'react-dom';
import { expect, it } from 'vitest';
import { render } from '../testing/render';
import { useFocusTrap } from './useFocusTrap';

function Child() {
  const ref = useFocusTrap(true);
  return createPortal(<div ref={ref} tabIndex={-1}><button id="child-first">子菜单一</button><button id="child-last">子菜单二</button></div>, document.body);
}
function Parent() {
  const ref = useFocusTrap(true);
  const [child, setChild] = useState(false);
  return <div ref={ref} tabIndex={-1}>
    <button id="first">首项</button><button hidden>隐藏</button><button tabIndex={-1}>不参与导航</button>
    <button id="open" onClick={() => setChild(true)}>打开子菜单</button>
    <button id="last" onClick={() => setChild(false)}>末项</button>{child && <Child />}
  </div>;
}
const tab = (shiftKey=false) => act(() => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', {key:'Tab',shiftKey,bubbles:true,cancelable:true})));
it('skips display-none ancestors and closed details while including their summary', () => {
  function HiddenContent() {
    const ref=useFocusTrap(true);
    return <div ref={ref} tabIndex={-1}>
      <div style={{display:'none'}}><button id="invisible">不可见</button></div>
      <button id="visible-first">首项</button>
      <details><summary id="summary">说明</summary><button id="collapsed">折叠按钮</button></details>
    </div>;
  }
  render(<HiddenContent />);
  expect(document.activeElement?.id).toBe('visible-first');
  tab(true);expect(document.activeElement?.id).toBe('summary');
  tab();expect(document.activeElement?.id).toBe('visible-first');
});
it('wraps focus and restores the opener on unmount', () => {
  const opener=document.createElement('button');document.body.append(opener);opener.focus();
  const {root}=render(<Parent />);
  expect(document.activeElement?.id).toBe('first');
  tab(true);expect(document.activeElement?.id).toBe('last');
  tab();expect(document.activeElement?.id).toBe('first');
  act(()=>root.unmount());expect(document.activeElement).toBe(opener);
});
it('lets a portalled child own focus, then resumes the parent trap', () => {
  render(<Parent />);
  const opener=document.getElementById('open')!;
  act(()=>{opener.focus();opener.click();});
  expect(document.activeElement?.id).toBe('child-first');
  tab(true);expect(document.activeElement?.id).toBe('child-last');
  tab();expect(document.activeElement?.id).toBe('child-first');
  act(()=>document.getElementById('last')!.click());
  expect(document.activeElement).toBe(opener);
  act(()=>document.getElementById('last')!.focus());tab();
  expect(document.activeElement?.id).toBe('first');
});
