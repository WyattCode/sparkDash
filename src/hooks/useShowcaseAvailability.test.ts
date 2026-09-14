import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listDecodeBench, listPrefillBench, listShowcase } from '../api/client';
import { checkShowcaseAvailability } from './useShowcaseAvailability';
vi.mock('../api/client', () => ({ listDecodeBench: vi.fn(), listPrefillBench: vi.fn(), listShowcase:vi.fn() }));
describe('showcase node-wide availability', () => {
  beforeEach(() => {
    vi.mocked(listShowcase).mockResolvedValue({active:null, history:[]});
    vi.mocked(listDecodeBench).mockResolvedValue({ active: null, history: [] } as never);
    vi.mocked(listPrefillBench).mockResolvedValue({ active: null, history: [] } as never);
  });
  it('allows an idle node and does not filter by port', async () => {
    expect(await checkShowcaseAvailability('test')).toBeNull();
    expect(listDecodeBench).toHaveBeenLastCalledWith('test');
  });
  it('blocks decode conflicts', async () => {
    vi.mocked(listDecodeBench).mockResolvedValue({ active: { id: 'busy' }, history: [] } as never);
    expect(await checkShowcaseAvailability('test')).toContain('解码基准测试');
  });
  it('blocks prefill conflicts', async () => {
    vi.mocked(listPrefillBench).mockResolvedValue({ active: { id: 'busy' }, history: [] } as never);
    expect(await checkShowcaseAvailability('test')).toContain('预填充基准测试');
  });
  it('does not assume idle if status is unavailable', async () => {
    vi.mocked(listDecodeBench).mockRejectedValue(new Error('offline'));
    await expect(checkShowcaseAvailability('test')).rejects.toThrow('offline');
  });
  it.each(['running','cancelling'])('blocks an existing %s showcase', async status => {
    vi.mocked(listShowcase).mockResolvedValue({active:{sessionId:'other-window',status},history:[]});
    expect(await checkShowcaseAvailability('test')).toContain('演示');
  });
});
