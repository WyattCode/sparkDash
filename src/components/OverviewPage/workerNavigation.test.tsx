import {act} from 'react';
import {expect,it,vi} from 'vitest';
import {render} from '../../testing/render';
import {makeSpark} from '../../testing/fixtures';
import {OverviewPage} from './OverviewPage';
vi.mock('./OperationsPanel',()=>({OperationsPanel:()=>null}));
function fixtures() {
  const head=makeSpark('head');head.role='head';
  const worker=makeSpark('worker');worker.role='worker';worker.workerHeadId=head.id;
  worker.workerDerivedLabel='DeepSeek';worker.metrics.llm=[];
  worker.telemetry={updatedAt:{gpu:Date.now()},successful:{gpu:true}};
  return {head,worker};
}
it('uses node data colors for model allocation while preserving low-memory warnings',()=>{
  const {head,worker}=fixtures();
  for(const spark of [head,worker]) {
    spark.telemetry={updatedAt:{gpu:Date.now()},successful:{gpu:true}};
    if(spark.metrics.gpu) spark.metrics.gpu.vram={...spark.metrics.gpu.vram,used:96000,total:120000,percentage:80,available:8000};
  }
  render(<OverviewPage sparks={[head,worker]}/>);
  for(const card of document.querySelectorAll('.overview-card')) {
    const allocation=card.querySelectorAll('.cockpit-node__bar .metric-bar-fill')[1];
    expect(allocation?.classList.contains('bg-accent')).toBe(true);
    expect(allocation?.classList.contains('bg-warning')).toBe(false);
    expect(card.querySelector('.cockpit-node__row .text-warning')).not.toBeNull();
  }
});
it('renders missing throughput safely even when called outside the snapshot hook',()=>{
  const {head}=fixtures();
  head.telemetry={updatedAt:{gpu:Date.now()},successful:{gpu:true}};
  Object.assign(head.metrics.llm[0],{generationTps:null,prefillTps:'invalid'});
  expect(()=>render(<OverviewPage sparks={[head]}/>)).not.toThrow();
  expect(document.querySelector('.cockpit-kpis strong')?.textContent).toBe('— tok/s');
  expect(document.body.textContent).not.toContain('NaN');
});
it('shows model ownership and a real head link without a worker throughput footer',()=>{
  const {head,worker}=fixtures();const select=vi.fn();
  render(<OverviewPage sparks={[head,worker]} onSelectSpark={select}/>);
  const card=document.querySelector('[data-node-role=worker]')!;
  expect(card.textContent).toContain('所属模型');
  expect(card.textContent).toContain('DeepSeek');
  expect(card.querySelector('.node-throughput')).toBeNull();
  expect(card.querySelector('.cockpit-node__details')?.textContent).toContain(head.name);
  expect(card.querySelector('.cockpit-node__details')?.textContent).toContain('分布式推理');
  expect(card.querySelector('[role=note]')).toBeNull();
  const link=card.querySelector<HTMLAnchorElement>('.worker-head-link')!;
  expect(link.textContent?.trim()).toBe(head.name);
  expect(link.closest('.cockpit-node__details')).not.toBeNull();
  expect(card.querySelector('.node-model-stat a')).toBeNull();
  expect(card.textContent).not.toContain('查看主节点');
  expect(link.getAttribute('href')).toBe('/spark/head');
  act(()=>link.click());expect(select).toHaveBeenCalledExactlyOnceWith('head');
  const info=card.querySelector<HTMLElement>('summary')!;
  act(()=>info.click());
  expect(card.querySelector('details')?.open).toBe(true);
  expect(card.querySelector('details')?.textContent).toContain('吞吐和延迟统一在主节点查看');
  act(()=>info.click());
  expect(card.querySelector('details')?.open).toBe(false);
});
it('does not invent a link for a missing or invalid head association',()=>{
  const {worker}=fixtures();
  render(<OverviewPage sparks={[worker]}/>);
  expect(document.querySelector('.worker-head-link')).toBeNull();
  expect(document.querySelector('.cockpit-node__details')?.textContent).toContain('未关联');
  act(()=>document.querySelector<HTMLElement>('.cockpit-node__details summary')!.click());
  expect(document.querySelector('.cockpit-node__details')?.textContent).toContain('尚未关联');
});
it('keeps the actual linked head when the head is filtered out or offline',()=>{
  const {head,worker}=fixtures();head.online=false;
  render(<OverviewPage sparks={[head,worker]} hideOffline/>);
  expect(document.querySelectorAll('.overview-card')).toHaveLength(1);
  const link=document.querySelector('.worker-head-link')!;
  expect(link.getAttribute('href')).toBe('/spark/head');
  expect(link.getAttribute('title')).toContain('当前离线');
});
