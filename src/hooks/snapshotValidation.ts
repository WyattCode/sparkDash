import type { SparkSnapshot } from '../api/types';
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const strings = (v: unknown) => Array.isArray(v) && v.every(x => typeof x === 'string');
/** Validate structures dereferenced by consumers before mutating history/state. */
export function validSnapshots(value: unknown): value is SparkSnapshot[] {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  return value.every(s => {
    if (!object(s) || typeof s.id !== 'string' || !s.id || ids.has(s.id) || typeof s.name !== 'string' || typeof s.online !== 'boolean') return false;
    ids.add(s.id);
    if (!object(s.hardware) || !strings(s.disabledDevices) || !strings(s.disabledInterfaces)) return false;
    const m = s.metrics;
    if (!object(m) || !Array.isArray(m.storage) || !m.storage.every(object) || !Array.isArray(m.llm) || !m.llm.every(object)) return false;
    if (m.gpu != null && (!object(m.gpu) || !object(m.gpu.power) || !object(m.gpu.vram))) return false;
    if (s.telemetry != null) {
      const t = s.telemetry;
      if (!object(t) || !object(t.updatedAt) || !object(t.successful)) return false;
      if (!Object.values(t.updatedAt).every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0) || !Object.values(t.successful).every(v => typeof v === 'boolean')) return false;
    }
    return true;
  });
}
