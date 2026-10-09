import {expect,it,vi} from 'vitest';
import {act} from 'react';
import {render} from '../../testing/render';
import {makeSpark} from '../../testing/fixtures';
import {SparkHero} from './SparkHero';
it('does not invent a model or live counts for an empty cluster',()=>{
 const {container}=render(<SparkHero sparks={[]} stale={false}/>);
 expect(container.textContent).toContain('暂无可用模型');
 expect(container.textContent).toContain('— / —');
 expect(container.querySelector('a')).toBeNull();
});
function head(){const s=makeSpark('head');s.role='head';return s;}
it('renders missing counts as unavailable, not zero; compacts context with exact tooltip',()=>{
 const s=head();s.metrics.llm[0].contextLength=262144;
 const {container}=render(<SparkHero sparks={[s]} stale={false}/>);
 expect(container.textContent).toContain('— / —');
 expect(container.textContent).toContain('256K');
 expect(container.querySelector('[title="262,144 tokens"]')).not.toBeNull();
});
it('rejects invalid negative throughput and zero context',()=>{
 const s=head();s.metrics.llm[0].generationTps=-1;s.metrics.llm[0].contextLength=0;
 const {container}=render(<SparkHero sparks={[s]} stale={false}/>);
 const values=[...container.querySelectorAll('.dgx-hero__metrics strong')].map(e=>e.textContent);
 expect(values[1]).toBe('— tok/s');expect(values[3]).toBe('—');
});
it('hides live model metrics when offline or stale',()=>{
 const s=head();s.online=false;
 const {container}=render(<SparkHero sparks={[s]} stale={false}/>);
 expect(container.querySelectorAll('.dgx-hero__metrics strong')[1].textContent).toBe('— tok/s');
 expect(container.textContent).toContain('服务不可用');
});
it('uses integer request counts and preserves navigation callback',()=>{
 const s=head();s.metrics.llm[0].requestsRunning=1;s.metrics.llm[0].requestsWaiting=0;
 const select=vi.fn();const {container}=render(<SparkHero sparks={[s]} stale={false} onSelect={select}/>);
 expect(container.textContent).toContain('1 / 0');
 const a=container.querySelector('a')!;
 expect(a.getAttribute('href')).toBe('/spark/head');
 act(()=>a.click());expect(select).toHaveBeenCalledWith('head');
});
it('marks stale cluster data explicitly',()=>{
 const {container}=render(<SparkHero sparks={[makeSpark('head')]} stale/>);
 expect(container.textContent).toContain('数据已过期');
 expect(container.textContent).toContain('等待新鲜数据');
});
