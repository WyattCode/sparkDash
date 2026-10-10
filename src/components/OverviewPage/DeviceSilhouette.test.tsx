import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { describe, it, expect } from 'vitest';
import { DeviceSilhouette } from './DeviceSilhouette';

describe('DeviceSilhouette', () => {
  it('matches live node identities and updates without a fixed or minimum machine count', async () => {
    const host = document.createElement('div'); const root = createRoot(host);
    const sparks = [{ id: 'head', online: true }, { id: 'worker', online: true }, { id: 'offline', online: false }];
    await act(async () => root.render(<DeviceSilhouette sparks={sparks} />));
    expect([...host.querySelectorAll('i')].map(i => i.dataset.nodeId)).toEqual(['head', 'worker']);
    const head = host.querySelector('i');
    await act(async () => root.render(<DeviceSilhouette sparks={[sparks[0]]} />));
    expect(host.querySelectorAll('i')).toHaveLength(1);
    expect(host.querySelector('i')).toBe(head);
    await act(async () => root.render(<DeviceSilhouette sparks={[sparks[2]]} />));
    expect(host.querySelectorAll('i')).toHaveLength(0);
    await act(async () => root.unmount());
  });
});
