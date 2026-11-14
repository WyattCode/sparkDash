import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {_resetStore,ingestSnapshots,getMetricHistorySamples,persistMetricHistory,restoreMetricHistory} from './metricsStore';
import {makeSpark} from '../testing/fixtures';
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(1_000_000);localStorage.clear();_resetStore();});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();localStorage.clear();_resetStore();});
it('restores real timestamps after reload and appends without inventing the refresh gap',()=>{
 const s=makeSpark();s.llmPorts=[8888];Object.assign(s.metrics.llm[0],{backend:'sglang',modelId:'ds',available:true,generationTps:42});
 ingestSnapshots([s],999000);persistMetricHistory();_resetStore();restoreMetricHistory();
 expect(getMetricHistorySamples(s.id,'llm:8888.tps')).toEqual([{at:999000,value:42}]);
 ingestSnapshots([s],1_020_000);
 expect(getMetricHistorySamples(s.id,'llm:8888.tps').map(p=>p.at)).toEqual([999000,1_020_000]);
 Object.assign(s.metrics.llm[0],{modelId:'different'});ingestSnapshots([s],1_021_000);
 expect(getMetricHistorySamples(s.id,'llm:8888.tps')).toHaveLength(1);
});
it('rejects expired, future and corrupt cached points',()=>{
 localStorage.setItem('sparkdash-metric-history-v1',JSON.stringify({identities:[],series:[['node:gpu.usage',[{at:1,value:1},{at:1_000_001,value:2},{at:999999,value:-1},{at:999998,value:3}]]]}));
 restoreMetricHistory();expect(getMetricHistorySamples('node','gpu.usage')).toEqual([{at:999998,value:3}]);
 localStorage.setItem('sparkdash-metric-history-v1','{');expect(()=>restoreMetricHistory()).not.toThrow();
});
it('continues monitoring when browser storage is denied',()=>{
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('denied');});
 expect(()=>ingestSnapshots([makeSpark()])).not.toThrow();
});
it('removes restored history for deleted nodes on the first authoritative snapshot',()=>{
 const s=makeSpark();ingestSnapshots([s],999000);persistMetricHistory();_resetStore();restoreMetricHistory();
 expect(getMetricHistorySamples(s.id,'gpu.usage').length).toBeGreaterThan(0);
 ingestSnapshots([],1_000_000);expect(getMetricHistorySamples(s.id,'gpu.usage')).toEqual([]);
});
