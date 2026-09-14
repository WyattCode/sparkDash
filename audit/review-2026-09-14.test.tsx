// Regression assertions for the reviewed bugs. Shutdown is covered by backend tests.
// Run only inside a disposable container. All APIs/processes are mocked.
import {it,expect,vi} from 'vitest';
import {act} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {render,flush} from '../src/testing/render';
import {translateZhCN} from '../src/i18n/zhCN';
import {gpuReady} from '../src/components/OverviewPage/operationsModel';
import {GpuPanel} from '../src/components/SparkPage/GpuPanel';
import {makeSpark} from '../src/testing/fixtures';
import {OperationsPanel} from '../src/components/OverviewPage/OperationsPanel';
import {fetchOperations,fetchVerification,runVerification} from '../src/api/client';
vi.mock('../src/api/client',()=>({fetchOperations:vi.fn(),fetchVerification:vi.fn(async()=>({supported:false,checkedAt:Date.now()})),fetchOperationsHistory:vi.fn(),testSpark:vi.fn(),runVerification:vi.fn(),fetchFleetEnergy:vi.fn()}));

it('Chinese translation preserves technical identifiers and model answer text',()=>{
  expect(translateZhCN('PowerShell /v1/models Worker namespace')).toBe('PowerShell /v1/models Worker namespace');
});
it('missing GPU readings render unknown instead of zeros and OK',()=>{
  const html=renderToStaticMarkup(<GpuPanel gpu={null} sparkId="fixture" temperatureUnit="celsius"/>);
  expect(html).not.toContain('>0%');expect(html).not.toContain('0°C');expect(html).not.toContain('OK');expect(html).toContain('未采集');
});
it('stale GPU data is hidden and real zero readings remain visible',()=>{
  const gpu=makeSpark().metrics.gpu!;
  gpu.usage=0;gpu.temperature=0;gpu.power.draw=0;
  const props={gpu,sparkId:'fixture',temperatureUnit:'celsius' as const};
  expect(renderToStaticMarkup(<GpuPanel {...props}/>)).toContain('0°C');
  const stale=renderToStaticMarkup(<GpuPanel {...props} unavailable/>);
  expect(stale).toContain('GPU 指标不可用');expect(stale).not.toContain('0°C');
});
it('optional malformed provenance is unavailable without crashing',()=>{
  expect(gpuReady({telemetry:{},online:true} as never)).toBe(false);
});
it('unavailable network counters are not summed to zero',async()=>{
  vi.mocked(fetchOperations).mockResolvedValue({generatedAt:Date.now(),startedAt:Date.now(),windowMinutes:30,metrics:{networkErrors:{series:[{labels:{node:'fixture'},points:[[Date.now(),null]]}],error:null},networkDrops:{series:[],error:null}},targets:[],targetError:null,events:[]});
  const {container}=render(<OperationsPanel sparks={[]} stale={false}/>);
  await flush();
  const tab=Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='互联与诊断')!;
  act(()=>tab.click());await flush();
  const row=Array.from(container.querySelectorAll('.ops-stat')).find(e=>e.textContent?.includes('网卡错误 · 次/s'))!;
  expect(row.querySelector('strong')?.textContent).toBe('未采集');
});

it('service details start collapsed and review retains explicit consent and rate-limit copy',async()=>{
  const spark=makeSpark();
  vi.mocked(fetchVerification).mockResolvedValue({supported:true,checkedAt:Date.now(),node:spark.name,port:8888,model:'fixture-model',storageError:'验收记录保存失败'});
  vi.mocked(fetchOperations).mockResolvedValue({generatedAt:Date.now(),startedAt:Date.now(),windowMinutes:30,metrics:{},targets:[],targetError:null,events:[]});
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
  vi.mocked(runVerification).mockClear();
  const {container}=render(<OperationsPanel sparks={[spark]} stale={false}/>);
  await flush();
  const details=container.querySelector('.ops-service-details') as HTMLDetailsElement;
  expect(details.open).toBe(false);
  expect(container.querySelectorAll('.ops-service summary')).toHaveLength(1);
  expect(details.querySelector('summary')?.textContent).toBe('验收与请求详情');
  expect(details.textContent).toContain('每 5 分钟最多一次');
  expect(container.querySelector('[role=alert]')?.closest('details')).toBeNull();
  const button=container.querySelector('.ops-verify-action') as HTMLButtonElement;
  expect(button.textContent).toBe('运行复验');
  expect(button.disabled).toBe(false);
  act(()=>button.click());
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('每 5 分钟最多一次'));
  expect(runVerification).not.toHaveBeenCalled();
});
