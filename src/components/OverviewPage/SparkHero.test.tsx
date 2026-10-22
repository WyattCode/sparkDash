import { expect, it, vi } from 'vitest';
import { act } from 'react';
import { render } from '../../testing/render';
import { makeSpark } from '../../testing/fixtures';
import { SparkHero, heroLatency } from './SparkHero';
import type { Operations } from './operationsModel';
import { recentTrend, trendScale } from './CockpitTrend';

function head() { const s = makeSpark('head'); s.role = 'head'; return s; }
it('does not invent a model, counts or links for an empty cluster', () => {
 const { container } = render(<SparkHero sparks={[]} stale={false} />);
 expect(container.textContent).toContain('暂无可用模型');
 expect([...container.querySelectorAll('.cockpit-kpis strong')].map(e => e.textContent)).toEqual(['— tok/s', '—', '— 个', '— 个']);
 expect(container.querySelector('a')).toBeNull();
});
it('keeps exact context information and missing requests unknown', () => {
 const s = head(); s.metrics.llm[0].contextLength = 262144;
 const { container } = render(<SparkHero sparks={[s]} stale={false} />);
 expect(container.textContent).toContain('256K');
 expect(container.querySelector('[title="262,144 tokens"]')).not.toBeNull();
 expect(container.querySelectorAll('.cockpit-kpis strong')[2].textContent).toBe('— 个');
});
it('rejects invalid throughput and context, and suppresses stale/offline metrics', () => {
 const s = head(); s.metrics.llm[0].generationTps = -1; s.metrics.llm[0].contextLength = 0;
 let view = render(<SparkHero sparks={[s]} stale={false} />);
 expect(view.container.querySelector('.cockpit-kpis strong')?.textContent).toBe('— tok/s');
 s.online = false; view = render(<SparkHero sparks={[s]} stale={false} />);
 expect(view.container.textContent).toContain('服务不可用');
 view = render(<SparkHero sparks={[s]} stale />);
 expect(view.container.textContent).toContain('等待新鲜数据');
});
it('uses integer requests and links only genuinely associated nodes', () => {
 const s = head(); s.metrics.llm[0].requestsRunning = 1; s.metrics.llm[0].requestsWaiting = 0;
 const worker = makeSpark('worker'); worker.role = 'worker'; worker.workerHeadId = s.id;
 const other = makeSpark('other'); other.role = 'worker'; other.workerHeadId = 'another';
 const select = vi.fn();
 const { container } = render(<SparkHero sparks={[s, worker, other]} stale={false} onSelect={select} />);
 expect(container.querySelectorAll('.cockpit-kpis strong')[2].textContent).toBe('1 个');
 expect(container.querySelectorAll('.cockpit-kpis strong')[3].textContent).toBe('0 个');
 expect(container.querySelectorAll('.cockpit-topology li')).toHaveLength(2);
 expect(container.querySelector('.cockpit-identity-heading .cockpit-service-link')).toBeNull();
 expect(container.querySelector('.cockpit-model-meta + .cockpit-service-link')).not.toBeNull();
 expect(container.querySelector('.cockpit-service-row .cockpit-service-link')).toBeNull();
 act(() => (container.querySelector('.cockpit-service-link') as HTMLAnchorElement).click());
 expect(location.search).toBe('?view=service');
 expect(select).not.toHaveBeenCalled();
 act(() => (container.querySelector('.cockpit-topology a') as HTMLAnchorElement).click());
 expect(select).toHaveBeenCalledWith('head');
 history.replaceState(null,'','/');
});
function ops(now: number): Operations {
 const labels = { node: 'Spark head', instance: 'fixture:8888', model_name: 'fixture-model' };
 return { generatedAt: now, startedAt: now, windowMinutes: 30, backend: 'vllm', targets: [{ labels: { ...labels, job: 'vllm' }, health: 'up', lastScrape: new Date(now).toISOString() }], targetError: null, events: [], metrics: {
  ttft: { error: null, series: [{ labels, points: [[now, .86]] }] },
  ttftSamples: { error: null, series: [{ labels, points: [[now, 3]] }] },
 } };
}
it('keeps the overview service summary free of repeated device roles and topology',()=>{
 const main=head(),worker=makeSpark('worker');worker.role='worker';worker.workerHeadId=main.id;
 const {container}=render(<SparkHero compact sparks={[main,worker]} stale={false}/>);
 expect(container.querySelector('.cockpit-topology')).toBeNull();
 expect(container.querySelector('.cockpit-identity')?.textContent).not.toMatch(/主节点|工作节点|机协同/);
 expect(container.querySelector('.cockpit-model-status')?.textContent).toBe('服务可用');
 expect(container.querySelector('.cockpit-model-meta + .cockpit-service-link')).not.toBeNull();
});
it('reuses the four-device artwork as decoration without duplicate node labels',()=>{
 const main=head(),workers=['a','b','c'].map(id=>{const s=makeSpark(id);s.role='worker';s.workerHeadId=main.id;return s;});
 const {container}=render(<SparkHero compact sparks={[main,...workers]} stale={false}/>);
 const art=container.querySelector('.cockpit-device-art');
 expect(art?.getAttribute('aria-hidden')).toBe('true');expect(art?.querySelectorAll('i')).toHaveLength(4);
 expect(art?.textContent).toBe('');expect(container.querySelector('.cockpit-topology')).toBeNull();
});
it('reads the matching model P95 and distinguishes no samples from missing', () => {
 const now = Date.now(), s = head(), data = ops(now);
 expect(heroLatency(data, s, 0, now)).toBe('0.86 s');
 data.metrics.ttftSamples.series[0].points[0][1] = 0;
 expect(heroLatency(data, s, 0, now)).toBe('暂无样本');
 data.metrics.ttftSamples.error = 'unavailable';
 expect(heroLatency(data, s, 0, now)).toBe('—');
});
it('refuses stale, wrong-engine, wrong-model and ambiguous P95 readings', () => {
 const now = Date.now(), s = head();
 expect(heroLatency(ops(now), s, 0, now + 46000)).toBe('—');
 const wrong = ops(now); wrong.backend = 'sglang';
 expect(heroLatency(wrong, s, 0, now)).toBe('—');
 const other = ops(now); other.metrics.ttft.series[0].labels.model_name = 'previous-model';
 expect(heroLatency(other, s, 0, now)).toBe('—');
 const duplicate = ops(now); duplicate.targets.push(duplicate.targets[0]);
 expect(heroLatency(duplicate, s, 0, now)).toBe('—');
});
it('keeps only genuine time-window samples without inventing idle data', () => {
 expect(recentTrend([{at: 1,value: 99},{at: 70000,value: 0},{at: 70001,value: -1},{at: 70002,value: NaN},{at: 80001,value: 5}], 80000)).toEqual([{at: 70000,value: 0}]);
});
it('uses readable chart ticks with headroom without clipping real peaks', () => {
 expect(trendScale(240)).toEqual({max:350,ticks:[0,100,200,300]});
 for(const peak of [0, .1, 1, 50, 79.5, 101, 500, 10000, NaN]) {
  const scale=trendScale(peak);
  expect(Number.isFinite(scale.max)).toBe(true);
  expect(scale.max).toBeGreaterThan(Number.isFinite(peak) ? peak : 0);
  expect(scale.ticks[0]).toBe(0);
  expect(scale.ticks.at(-1)).toBeLessThan(scale.max);
 }
});

it('keeps ATOM branding and maps compact machines to actual online nodes without invented model metadata',()=>{
 const s=head();Object.assign(s.metrics.llm[0],{backend:'tensorfold',contextLength:null,parallelism:null});
 const worker=makeSpark('worker');worker.role='worker';worker.workerHeadId=s.id;worker.online=false;
 let view=render(<SparkHero sparks={[s,worker]} stale={false} compact/>);
 expect(view.container.textContent).toContain('GIGABYTE AI TOP ATOM');
 expect(view.container.textContent).not.toContain('并行配置');expect(view.container.querySelectorAll('.cockpit-device-art i')).toHaveLength(1);
 worker.online=true;view=render(<SparkHero sparks={[s,worker]} stale={false} compact/>);
 expect(view.container.querySelectorAll('.cockpit-device-art i')).toHaveLength(2);
});
