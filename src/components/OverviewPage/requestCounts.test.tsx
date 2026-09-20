import {expect,it,vi} from 'vitest';
import {render,flush} from '../../testing/render';
import {makeSpark} from '../../testing/fixtures';
import {OperationsPanel} from './OperationsPanel';
import {fetchOperations,fetchVerification} from '../../api/client';
vi.mock('../../api/client',()=>({fetchOperations:vi.fn(),fetchVerification:vi.fn(),fetchOperationsHistory:vi.fn(),testSpark:vi.fn(),runVerification:vi.fn(),fetchFleetEnergy:vi.fn()}));
it('distinguishes current integer request counts from estimated window counts',async()=>{
  const spark=makeSpark();const now=Date.now();
  const labels={node:spark.name,instance:'localhost:8888',model_name:'fixture-model'};
  const metric=(value:number,extra={})=>({series:[{labels:{...labels,...extra},points:[[now,value] as [number,number]]}],error:null});
  vi.mocked(fetchVerification).mockResolvedValue({supported:false,checkedAt:now});
  vi.mocked(fetchOperations).mockResolvedValue({generatedAt:now,startedAt:now,windowMinutes:30,events:[],targetError:null,
    targets:[{labels:{...labels,job:'vllm'},health:'up',lastScrape:new Date(now).toISOString()}],
    metrics:{running:metric(1),waiting:metric(0),finished:metric(2.4,{finished_reason:'stop'}),httpErrors:metric(.25,{status_code:'503'}),httpTotal:metric(2.65),httpOk:metric(2.4)}});
  render(<OperationsPanel sparks={[spark]} stale={false}/>);await flush();
  const stat=[...document.querySelectorAll('.ops-stat')].find(e=>e.firstElementChild?.textContent==='处理中 / 排队中')!;
  expect(stat.querySelector('strong')?.textContent).toBe('1 / 0');
  expect(stat.textContent).toContain('非模型数或人数');
  const legend=document.querySelector('.ops-service-detail-grid .ops-legend')!;
  expect(legend.textContent).toContain('stop：约 2 次');
  expect(legend.textContent).toContain('503：不足 1 次（估算）');
});
