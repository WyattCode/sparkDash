import {render} from '../../testing/render';
import {act} from 'react';
import {describe,it,expect,vi} from 'vitest';
import {OperationsPanel} from './OperationsPanel';
import {makeSpark} from '../../testing/fixtures';

vi.mock('../../api/client',()=>({
  fetchOperations:vi.fn(async()=>({generatedAt:Date.now(),startedAt:Date.now(),windowMinutes:30,metrics:{},targets:[],targetError:null,events:[]})),
  fetchVerification:vi.fn(async()=>({supported:false,checkedAt:Date.now()})),
  fetchOperationsHistory:vi.fn(),testSpark:vi.fn(),runVerification:vi.fn(),
}));
describe('service footer capability boundaries',()=>{
  it('TensorFold has no empty footer or removed control-center entry',async()=>{
    const spark=makeSpark();spark.role='head';spark.workerNode=false;
    Object.assign(spark.metrics.llm[0],{backend:'tensorfold',modelId:'GLM-5.3-Flash-EXL3'});
    const {container}=render(<OperationsPanel sparks={[spark]} stale={false}/>);
    await act(async()=>{await Promise.resolve();});
    expect(container.textContent).toContain('监控更新：');
    expect(container.querySelector('.ops-service-footer')).toBeNull();
    expect(container.textContent).not.toContain('打开控制中心');
    expect(container.textContent).not.toContain('推理接口 HTTP 成功率');
    expect(container.textContent).not.toContain('字间延迟 P95');
  });
  it('retains the legacy service details footer for supported older engines',async()=>{
    const spark=makeSpark();spark.role='head';spark.workerNode=false;
    Object.assign(spark.metrics.llm[0],{backend:'sglang',modelId:'legacy'});
    const {container}=render(<OperationsPanel sparks={[spark]} stale={false}/>);
    await act(async()=>{await Promise.resolve();});
    expect(container.textContent).toContain('监控更新：');
    expect(container.querySelectorAll('.ops-service-footer')).toHaveLength(1);
    expect(container.textContent).toContain('验收与请求详情');
  });
  it('standardizes engine, context and latency labels without losing the exact context',async()=>{
    const spark=makeSpark();spark.role='head';spark.workerNode=false;
    Object.assign(spark.metrics.llm[0],{backend:'sglang',contextLength:1048576});
    const {container}=render(<OperationsPanel sparks={[spark]} stale={false} view="service"/>);
    await act(async()=>{await Promise.resolve();});
    expect(container.querySelector('.ops-service-meta')?.textContent).toContain('SGLang');
    expect(container.querySelector('.ops-service-meta')?.textContent).toContain('上下文 1M');
    expect(container.querySelector('[title="1,048,576 tokens"]')).not.toBeNull();
    expect(container.textContent).toContain('首字延迟 P95');expect(container.textContent).toContain('字间延迟 P95');
  });
  it('does not repeat the history title in its dedicated workspace',async()=>{
    const {container}=render(<OperationsPanel sparks={[makeSpark()]} stale={false} view="history"/>);
    await act(async()=>{await Promise.resolve();});
    expect([...container.querySelectorAll('h2,h3')].filter(e=>e.textContent==='性能历史')).toHaveLength(1);
    expect(container.querySelector('[aria-label="历史指标"]')).not.toBeNull();
  });
});
