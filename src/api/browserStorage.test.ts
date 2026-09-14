import { afterEach, expect, it, vi } from 'vitest';
import { readAccessToken } from './browserStorage';
import { apiFetch } from './client';
afterEach(() => vi.unstubAllGlobals());
it('storage method denial is safe and does not invent an authorization header', async () => {
  vi.stubGlobal('localStorage', {getItem: () => {throw new DOMException('Denied', 'SecurityError');}});
  const fetch = vi.fn().mockResolvedValue({ok:true,json:async()=>({})});vi.stubGlobal('fetch',fetch);
  expect(readAccessToken()).toBe('');await apiFetch('/api/read-only');
  expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
});
it('storage property denial and missing storage are safe', () => {
  const original=Object.getOwnPropertyDescriptor(globalThis,'localStorage')!;
  try {
    Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw new DOMException('Denied','SecurityError');}});
    expect(readAccessToken()).toBe('');
  } finally {Object.defineProperty(globalThis,'localStorage',original);}
  vi.stubGlobal('localStorage',undefined);expect(readAccessToken()).toBe('');
});
it('each HTTP request uses the current token, never the token cached at import',async()=>{
  let token='first';vi.stubGlobal('localStorage',{getItem:()=>token});
  const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({})});vi.stubGlobal('fetch',fetch);
  await apiFetch('/api/read-only');token='second';await apiFetch('/api/read-only');
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer first');
  expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer second');
});
