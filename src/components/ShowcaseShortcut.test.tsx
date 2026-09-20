import { expect, it } from 'vitest';
import { render } from '../testing/render';
import { makeSpark } from '../testing/fixtures';
import { ShowcaseShortcut, showcaseShortcutHref } from './ShowcaseShortcut';

it('prefers the head, skips workers and does not hardcode a node ID', () => {
  const worker = {...makeSpark('worker'),role:'worker' as const};
  const head = {...makeSpark('head/a'),role:'head' as const,llmPorts:[8888]};
  expect(showcaseShortcutHref([worker,makeSpark('solo'),head])).toMatch(/^\/showcase\/head%2Fa\?port=8888/);
  expect(showcaseShortcutHref([worker])).toBeNull();
});
it('uses a normal accessible link; no test is started by rendering', () => {
  const {container} = render(<ShowcaseShortcut sparks={[makeSpark('head')]} />);
  expect(container.querySelector('a')?.getAttribute('href')).toContain('/showcase/head?');
  expect(container.querySelector('a')?.getAttribute('aria-label')).toBe('并发生成测试');
  expect(container.querySelector('svg')?.getAttribute('stroke-width')).toBe('2');
});
it('disables the shortcut when no model node is configured', () => {
  const {container} = render(<ShowcaseShortcut sparks={[]} />);
  expect(container.querySelector('a')).toBeNull();
  expect(container.querySelector('button')?.disabled).toBe(true);
});
