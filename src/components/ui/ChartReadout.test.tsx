import {act} from 'react';
import {afterEach,expect,it} from 'vitest';
import {render,cleanupRenders} from '../../testing/render';
import {ChartReadout,pickReadout,placeReadout} from './ChartReadout';
afterEach(cleanupRenders);
it('keeps long floating readings inside the viewport and flips below at the top',()=>{
 expect(placeReadout(310,20,180,100,320,500)).toEqual({left:132,top:32});
 expect(placeReadout(5,490,180,100,320,500)).toEqual({left:8,top:378});
 expect(pickReadout([{value:1}],NaN,0)).toBeNull();
});
it('dismisses floating readings when the document scrolls',()=>{
 const ui=render(<ChartReadout samples={[{value:1}]}><svg/></ChartReadout>),root=ui.container.querySelector('[tabindex]')!;
 act(()=>root.dispatchEvent(new FocusEvent('focusin',{bubbles:true})));
 expect(document.querySelector('[role=tooltip]')).not.toBeNull();
 act(()=>document.dispatchEvent(new Event('scroll')));expect(document.querySelector('[role=tooltip]')).toBeNull();
});
it('selects real timestamps and does not report readings over gaps or axis labels',()=>{
 const samples=[{at:10000,value:1},{at:11000,value:2},{at:60000,value:3}];const window={end:60000,span:60000,left:34,right:8};
 expect(pickReadout(samples,0,642,window)).toBeNull();
 expect(pickReadout(samples,144/642,642,window)).toBe(1);
 expect(pickReadout(samples,334/642,642,window)).toBeNull();
 expect(pickReadout(samples,1,642,window)).toBeNull();
});
it('supports keyboard readings, escapes and removes portal on unmount',()=>{
 const ui=render(<ChartReadout samples={[{at:1000,value:12.34},{at:2000,value:56.78}]} label="GPU 功耗" unit="W"><svg/></ChartReadout>);
 const root=ui.container.querySelector('[tabindex]')!;
 act(()=>root.dispatchEvent(new FocusEvent('focusin',{bubbles:true})));
 expect(document.querySelector('[role=tooltip]')?.textContent).toContain('56.78 W');
 expect(root.getAttribute('aria-describedby')).toBe(document.querySelector('[role=tooltip]')?.id);
 act(()=>root.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true})));
 expect(document.querySelector('[role=tooltip]')?.textContent).toContain('12.34 W');
 act(()=>root.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 expect(document.querySelector('[role=tooltip]')).toBeNull();
 expect(root.hasAttribute('aria-describedby')).toBe(false);
 cleanupRenders();expect(document.querySelector('[role=tooltip]')).toBeNull();
});
it('anchors the active dot and follows painted frames without pointer movement',()=>{
 let point={x:25,y:18,top:5,bottom:10};
 const ui=render(<ChartReadout samples={[{value:9}]} marker={()=>point}><svg/></ChartReadout>);
 const root=ui.container.querySelector('[tabindex]')!;
 act(()=>root.dispatchEvent(new FocusEvent('focusin',{bubbles:true})));
 const dot=ui.container.querySelector<HTMLElement>('.chart-readout__dot')!;
 expect(dot.style.left).toBe('25px');expect(dot.style.top).toBe('18px');
 point={...point,x:30,y:12};act(()=>root.dispatchEvent(new Event('chartpaint')));
 expect(dot.style.left).toBe('30px');expect(dot.style.top).toBe('12px');
 act(()=>root.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 expect(ui.container.querySelector('.chart-readout__dot')).toBeNull();
});
