import type { SparkSnapshot } from '../api/types';
import { isLlmMonitoringEnabled, isWorkerSpark, resolveSparkRole } from '../api/sparkRole';
import { ConcurrentGenerationIcon } from './ui/icons';

export function showcaseShortcutHref(sparks: SparkSnapshot[]): string | null {
  const candidates = sparks.filter(s => !isWorkerSpark(s) && isLlmMonitoringEnabled(s));
  const spark = candidates.find(s => resolveSparkRole(s) === 'head') || candidates[0];
  if (!spark) return null;
  const index = spark.metrics.llm?.findIndex(m => m.available) ?? -1;
  const port = spark.llmPorts?.[index >= 0 ? index : 0] ?? spark.llmPort ?? 8888;
  const query = new URLSearchParams({ port: String(port) });
  const model = index >= 0 ? spark.metrics.llm?.[index]?.modelId : null;
  if (model) query.set('model', model);
  return `/showcase/${encodeURIComponent(spark.id)}?${query}`;
}

export function ShowcaseShortcut({ sparks }: { sparks: SparkSnapshot[] }) {
  const href = showcaseShortcutHref(sparks);
  return href ? <a href={href} className="icon-circle" aria-label="并发生成测试" title="并发生成测试">
    <ConcurrentGenerationIcon className="h-4 w-4" />
  </a> : <button type="button" className="icon-circle" disabled aria-label="并发生成测试（无可用主节点）" title="未配置模型主节点">
    <ConcurrentGenerationIcon className="h-4 w-4" />
  </button>;
}
