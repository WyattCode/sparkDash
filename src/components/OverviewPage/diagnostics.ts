import type { SparkSnapshot } from '../../api/types';
import type { Operations } from './operationsModel';

// No raw strings from snapshots, labels, URLs, model output or event messages
// cross this boundary. Names/IPs are deliberately omitted, not regex-redacted.
export function buildDiagnostics(sparks: SparkSnapshot[], data: Operations | null, stale: boolean, now = Date.now()) {
  const aliases = new Map(sparks.map((s, i) => [s.name, `node-${i + 1}`]));
  const time = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const jobs = new Set(['node', 'dcgm', 'vllm', 'vllm-config']);
  return {
    schemaVersion: 1,
    at: time(now),
    generatedAt: time(data?.generatedAt),
    stale,
    privacy: '匿名导出：不含节点名称、地址、凭据、自定义标签或事件原文。',
    nodes: sparks.map((s, i) => ({
      node: `node-${i + 1}`,
      role: s.role === 'head' ? 'head' : s.role === 'worker' ? 'worker' : 'standalone',
      online: s.online === true,
    })),
    targetCollectionFailed: !data || !!data.targetError,
    eventStorageFailed: !!data?.eventStorageError,
    targets: (data?.targets ?? []).map(t => ({
      node: aliases.get(t.labels.node) ?? null,
      job: jobs.has(t.labels.job) ? t.labels.job : 'other',
      health: t.health === 'up' ? 'up' : t.health === 'down' ? 'down' : 'unknown',
      lastScrapeAt: time(Date.parse(t.lastScrape)),
    })),
    // Preserve timing and attribution, not arbitrary free text.
    events: (data?.events ?? []).slice(0, 100).map(e => ({
      at: time(e.at), node: aliases.get(e.node) ?? null,
      category: e.message.includes('采集目标从配置中消失') ? 'target-missing'
        : e.message.includes('首次观察') ? 'first-observed'
        : e.message.includes('状态变化') ? 'state-changed' : 'other',
    })),
  };
}
