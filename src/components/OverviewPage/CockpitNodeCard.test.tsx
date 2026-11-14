import { expect, it, vi } from 'vitest';
import { act } from 'react';
import { render } from '../../testing/render';
import { makeSpark } from '../../testing/fixtures';
import { CockpitNodeCard } from './CockpitNodeCard';
function fresh() {
  const spark = makeSpark();
  spark.telemetry = { successful: { gpu: true }, updatedAt: { gpu: Date.now() } } as typeof spark.telemetry;
  return spark;
}
it('shows real values, a collapsed details section and a functional node link', () => {
  const spark = fresh(), select = vi.fn();
  const { container } = render(<CockpitNodeCard spark={spark} stale={false} temperatureUnit="celsius" onSelect={select} />);
  expect(container.textContent).toContain('42%');
  expect(container.textContent).toContain('55°C');
  expect(container.textContent).toContain('50 W');
  expect(container.querySelector('details')?.open).toBe(false);
  act(() => container.querySelector('a')!.click());
  expect(select).toHaveBeenCalledWith(spark.id);
});
it('never converts missing/stale GPU values into zero', () => {
  const spark = fresh(); spark.metrics.gpu!.power.draw = NaN;
  const { container } = render(<CockpitNodeCard spark={spark} stale={false} temperatureUnit="celsius" />);
  expect(container.textContent).not.toContain('NaN');
  expect(container.querySelector('[data-metric="gpu-power"]')?.textContent).toContain('—');
  const stale = render(<CockpitNodeCard spark={spark} stale temperatureUnit="celsius" />);
  expect(stale.container.querySelector('.cockpit-node__status')?.getAttribute('aria-label')).toBe('数据已过期');
  expect(stale.container.querySelector('.cockpit-node__body')?.textContent).not.toContain('42%');
  expect(stale.container.querySelector('.cockpit-node__body')?.textContent).not.toContain('0 W');
});
it('retains worker-to-head navigation and Fahrenheit temperature', () => {
  const spark = fresh(), head = makeSpark('head'), select = vi.fn();
  spark.role = 'worker'; spark.workerHeadId = head.id; spark.workerDerivedLabel = 'fixture-model';
  const { container } = render(<CockpitNodeCard spark={spark} headSpark={head} stale={false} temperatureUnit="fahrenheit" onSelect={select} />);
  expect(container.textContent).toContain('131°F');
  expect(container.textContent).toContain('fixture-model');
  act(() => (container.querySelector('.worker-head-link') as HTMLAnchorElement).click());
  expect(select).toHaveBeenCalledWith(head.id);
});
it('keeps matching shared structures for main and worker node cards', () => {
  const head = fresh(); head.role = 'head'; const worker = fresh(); worker.role = 'worker';
  const { container } = render(<><CockpitNodeCard spark={head} stale={false} temperatureUnit="celsius" /><CockpitNodeCard spark={worker} stale={false} temperatureUnit="celsius" /></>);
  const cards = [...container.querySelectorAll('.cockpit-node')];
  expect(cards.map(c => c.querySelectorAll('.cockpit-node__row').length)).toEqual([5, 5]);
  expect(cards.map(c => c.querySelectorAll('.cockpit-node__header summary').length)).toEqual([1, 1]);
  for(const card of cards)expect([...card.querySelectorAll('[data-metric]')].map(e=>e.getAttribute('data-metric'))).toEqual(['gpu-usage','gpu-memory','gpu-temperature','gpu-power']);
});
