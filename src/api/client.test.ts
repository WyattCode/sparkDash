import {afterEach,expect,it,vi} from 'vitest';
import {apiFetch} from './client';
afterEach(()=>vi.unstubAllGlobals());
it('network failure on writes is unconfirmed, never automatically retried',async()=>{
  const fetch=vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));vi.stubGlobal('fetch',fetch);
  await expect(apiFetch('/api/mock',{method:'POST'})).rejects.toThrow('操作结果尚未确认');expect(fetch).toHaveBeenCalledOnce();expect(fetch.mock.calls[0][1].signal).toBeDefined();
});
it('read failure is clearly distinct from write uncertainty',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockRejectedValue(Error('offline')));
  await expect(apiFetch('/api/mock')).rejects.toThrow('网络请求失败或超时');
});
it('malformed successful JSON is not treated as a confirmed action',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>{throw Error('invalid');}}));
  await expect(apiFetch('/api/mock',{method:'POST'})).rejects.toThrow('操作结果未确认');
});
it('known authentication errors translate without rewriting server details',async()=>{
  const fetch=vi.fn().mockResolvedValue({ok:false,status:401,json:async()=>({error:'Authentication required'})});vi.stubGlobal('fetch',fetch);
  await expect(apiFetch('/api/mock')).rejects.toThrow('访问令牌');
  fetch.mockResolvedValue({ok:false,status:500,json:async()=>({error:'PowerShell /v1/models namespace'})});
  await expect(apiFetch('/api/mock')).rejects.toThrow('PowerShell /v1/models namespace');
});
