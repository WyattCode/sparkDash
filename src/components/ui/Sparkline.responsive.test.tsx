import {act} from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {render} from '../../testing/render';
import {Sparkline} from './Sparkline';
afterEach(()=>vi.restoreAllMocks());
it('keeps the hover dot aligned when SVG width is reduced on a narrow screen',()=>{
 vi.spyOn(SVGElement.prototype,'getBoundingClientRect').mockReturnValue({left:0,top:0,width:90,height:24,right:90,bottom:24,x:0,y:0,toJSON:()=>({})});
 const {container}=render(<Sparkline data={[0,50,100]} width={180}/>),root=container.querySelector('.chart-readout')!;
 act(()=>root.dispatchEvent(new FocusEvent('focusin',{bubbles:true})));
 expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 180 24');
 expect((container.querySelector('.chart-readout__dot') as HTMLElement).style.left).toBe('90px');
});
