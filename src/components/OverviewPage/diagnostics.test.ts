import {expect,it} from 'vitest';
import type {SparkSnapshot} from '../../api/types';
import type {Operations} from './operationsModel';
import {buildDiagnostics} from './diagnostics';
it('exports only safe anonymous fields, even when labels and free text contain secrets',()=>{
  const secret='NEVER_EXPORT_secret_987';
  const nodes=[{name:secret,role:secret,online:true,ssh:{password:secret},llmApiKeys:{8888:secret}}] as unknown as SparkSnapshot[];
  const data={generatedAt:123,targets:[{labels:{node:secret,job:'dcgm',instance:`https://user:${secret}@host/?token=${secret}`,api_key:secret},health:'up',lastScrape:'2026-09-14T00:00:00Z'},{labels:{job:secret},health:secret,lastScrape:secret}],events:[{at:123,node:secret,message:`状态变化 ${secret}`,password:secret}],targetError:secret,eventStorageError:secret} as unknown as Operations;
  const out=buildDiagnostics(nodes,data,true,456);expect(JSON.stringify(out)).not.toContain(secret);expect(out.nodes[0].node).toBe('node-1');expect(out.targets[0].job).toBe('dcgm');expect(out.targets[1].job).toBe('other');expect(out.events[0].category).toBe('state-changed');expect(out.targetCollectionFailed).toBe(true);
});
it('missing data is explicitly incomplete and invalid timestamps become null',()=>{
  const out=buildDiagnostics([],null,true,NaN);expect(out.at).toBeNull();expect(out.generatedAt).toBeNull();expect(out.targetCollectionFailed).toBe(true);expect(out.targets).toEqual([]);
});
