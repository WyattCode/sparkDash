import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { render, flush } from '../testing/render';
import { usePwaInstall } from './usePwaInstall';

function Harness() {
  const p = usePwaInstall();
  return <><button disabled={!p.ready || p.busy} onClick={() => void p.install()}>安装</button><p>{p.installed ? '已安装' : p.message || '未安装'}</p></>;
}
afterEach(() => vi.unstubAllGlobals());
it('does not claim installation eligibility without a browser event', () => {
  const { container } = render(<Harness />);
  expect(container.querySelector('button')?.disabled).toBe(true);
  expect(container.textContent).toContain('未安装');
});
it('uses one prompt per event and waits for appinstalled to claim success', async () => {
  const { container } = render(<Harness />);
  const prompt = vi.fn().mockResolvedValue(undefined);
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt, userChoice: Promise.resolve({ outcome: 'accepted' }) });
  act(() => window.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  act(() => container.querySelector('button')!.click());
  await flush();
  expect(prompt).toHaveBeenCalledOnce();
  expect(container.textContent).toContain('安装请求已提交');
  expect(container.querySelector('button')?.disabled).toBe(true);
  act(() => window.dispatchEvent(new Event('appinstalled')));
  expect(container.textContent).toContain('已安装');
});
it('explains dismissal and supports standalone detection', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const { container } = render(<Harness />);
  act(() => window.dispatchEvent(Object.assign(new Event('beforeinstallprompt'), { prompt: async () => {}, userChoice: Promise.resolve({ outcome: 'dismissed' }) })));
  act(() => container.querySelector('button')!.click());
  await flush();
  expect(container.textContent).toContain('已取消安装');
});
it('recognizes launch in standalone mode', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const { container } = render(<Harness />);
  expect(container.textContent).toContain('已安装');
});
