import {expect,it} from 'vitest';
import {render} from '../../testing/render';
import {MetricBar} from './MetricBar';
it.each(['warning','danger'] as const)('keeps %s temperature rows compact and consistent with CPU rows',state=>{
 const {container}=render(<MetricBar label="GPU 温度" value={90} max={100} autoBand={false} color={`bg-${state}`} caption="90°C"/>);
 expect(container.textContent).not.toMatch(/高温告警|温度偏高/);
 expect(container.querySelector('.font-tabular')?.classList.contains('text-text')).toBe(true);
 expect(container.querySelector('.metric-bar-fill')?.classList.contains(`bg-${state}`)).toBe(true);
});
it('does not add an alarm to normal temperature',()=>{
 const {container}=render(<MetricBar label="GPU 温度" value={45} max={100} autoBand={false} color="bg-data"/>);
 expect(container.textContent).not.toMatch(/高温告警|温度偏高/);
});
it.each([-5,NaN,Infinity])('never renders an invalid or negative width for %s',value=>{
 const {container}=render(<MetricBar label="GPU" value={value} max={100}/>);
 expect((container.querySelector('.metric-bar-fill') as HTMLElement).style.getPropertyValue('--bar-pct')).toBe('0%');
});
