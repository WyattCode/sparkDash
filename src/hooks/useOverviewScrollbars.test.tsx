import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { render } from '../testing/render';
import { useOverviewScrollbars } from './useOverviewScrollbars';
function Harness({ enabled = true }: { enabled?: boolean }) {
  useOverviewScrollbars(enabled);
  return <div className="app-frame"><main><div className="ops-tabs" /></main></div>;
}
afterEach(() => vi.useRealTimers());
it('shows only the scrolling surface, then hides it after inactivity', () => {
  vi.useFakeTimers();
  const { container, root } = render(<Harness />);
  const tabs = container.querySelector('.ops-tabs')!;
  expect(document.documentElement.classList.contains('overview-scrollbars')).toBe(true);
  expect(tabs.hasAttribute('data-scrolling')).toBe(false);
  tabs.dispatchEvent(new Event('scroll'));
  expect(tabs.getAttribute('data-scrolling')).toBe('true');
  expect(document.documentElement.hasAttribute('data-scrolling')).toBe(false);
  vi.advanceTimersByTime(700);
  tabs.dispatchEvent(new Event('scroll'));
  vi.advanceTimersByTime(700);
  expect(tabs.hasAttribute('data-scrolling')).toBe(true);
  vi.advanceTimersByTime(201);
  expect(tabs.hasAttribute('data-scrolling')).toBe(false);
  document.dispatchEvent(new Event('scroll'));
  expect(document.documentElement.hasAttribute('data-scrolling')).toBe(true);
  act(() => root.render(<Harness enabled={false} />));
  expect(document.documentElement.classList.contains('overview-scrollbars')).toBe(false);
  expect(document.documentElement.hasAttribute('data-scrolling')).toBe(false);
});
