import {expect,it,vi} from 'vitest';
import {render} from '../../testing/render';
import {HistoryChart,historyTick} from './HistoryChart';
it('does not duplicate low-range axis labels after rounding',()=>{
 expect([1,2/3,1/3,0].map(v=>historyTick(v,1))).toEqual(['1','0.67','0.33','0']);
});
it('clips traces to the plot and does not let corrupt samples poison the axis',()=>{
 vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
 const now=Date.now();
 const {container}=render(<HistoryChart minutes={30} motionKey="fixture" series={[{labels:{node:'test'},points:[[now-2000,1],[NaN,Infinity],[now-1000,NaN],[now,0]]}]}/>);
 expect(container.querySelector('clipPath rect')).not.toBeNull();
 expect(container.innerHTML).not.toContain('NaN');expect(container.innerHTML).not.toContain('Infinity');
 expect(container.querySelector('[clip-path]')).not.toBeNull();vi.unstubAllGlobals();
});
