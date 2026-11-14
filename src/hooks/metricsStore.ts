import { useSyncExternalStore } from "react";
import type { SparkSnapshot } from "../api/types";
import { TimedRingBuffer, type TimedSample } from "./ringBuffer";

/**
 * Central metrics history store (idea #8b).
 *
 * Fed once per WebSocket snapshot by useSnapshot. Components read time-series
 * via `useMetricsHistory` / `useMetricsHistoryTail` — a single source of truth that:
 *   - survives Spark tab switches (history is no longer per-panel useState),
 *   - caps each series at HISTORY_MAX samples (1 h at the default 2 s poll),
 *   - lets future time-range charts read from one place,
 *   - keeps sparklines on a short tail (SPARKLINE_TAIL) so 84px charts stay readable.
 *
 * Also keeps the latest snapshot per spark (`getSpark` / `useSpark`) as the
 * selective-subscription seam (#8a).
 *
 * Reference-stability contract (required by useSyncExternalStore):
 * getSnapshot returns a *cached* value that only changes when that slice
 * actually changed. On each ingest we replace the history array with a new ref
 * (slice + append), so subscribers to that key re-render and all others skip.
 * All listeners are woken on notify; unchanged keys keep the same ref → no render.
 */

// History depth, configurable at build time. VITE_HISTORY_HOURS = wall-clock
// hours to retain (default 8 h at the 2 s WS poll ≈ 112 KB per series — the
// browser tab is the only thing that pays for it).
const SAMPLES_PER_HOUR = 1800; // 2 s poll
const HISTORY_HOURS = Number(import.meta.env.VITE_HISTORY_HOURS ?? 8) || 8;
export const HISTORY_MAX = Math.round(SAMPLES_PER_HOUR * HISTORY_HOURS);
/** Samples shown in inline sparklines (≈1 min at 2 s poll). Full series stays in HISTORY_MAX. */
export const SPARKLINE_TAIL = 30;

const history = new Map<string, TimedRingBuffer>(); // key: `${sparkId}:${metric}`
const historySamples = new Map<string, readonly TimedSample[]>();
const historyValues = new Map<string, readonly number[]>();
/** Cached last-N views — refreshed whenever the full series is replaced. */
const historyTails = new Map<string, readonly number[]>();
const sparkMap = new Map<string, SparkSnapshot>();
const llmIdentities=new Map<string,string>();
let lastSnapshotAt = -Infinity;
const listeners = new Set<() => void>();

const EMPTY: readonly number[] = Object.freeze([] as number[]);

// Persist only bounded numeric telemetry, never snapshots, credentials or prompts.
const CACHE_KEY = 'sparkdash-metric-history-v1';
const CACHE_WINDOW = 120_000;
let lastSaved = 0;
export function persistMetricHistory(): void {
  try {
    const cutoff = Date.now() - CACHE_WINDOW;
    const series = [...historySamples].map(([key, samples]) => [key, samples.filter(s => s.at >= cutoff).slice(-240)] as const).filter(([, samples]) => samples.length).slice(-256);
    localStorage.setItem(CACHE_KEY, JSON.stringify({series, identities:[...llmIdentities].slice(-64)}));
    lastSaved = Date.now();
  } catch { /* Storage denial/quota must not interrupt live monitoring. */ }
}
export function restoreMetricHistory(): void {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw || raw.length > 4_000_000) return;
    const saved = JSON.parse(raw), now = Date.now();
    if (!Array.isArray(saved.series) || !Array.isArray(saved.identities)) return;
    for (const entry of saved.identities.slice(0,64)) {
      if (Array.isArray(entry) && entry.length===2 && entry.every(v=>typeof v==='string' && v.length<1024)) llmIdentities.set(entry[0],entry[1]);
    }
    for (const entry of saved.series.slice(0,256)) {
      if (!Array.isArray(entry) || typeof entry[0]!=='string' || entry[0].length>256 || !Array.isArray(entry[1])) continue;
      for (const s of entry[1].slice(-240)) {
        if (s && Number.isFinite(s.at) && s.at>=now-CACHE_WINDOW && s.at<=now && Number.isFinite(s.value) && s.value>=0) pushHistory(entry[0],s.value,s.at);
      }
    }
    notify();
  } catch { /* Corrupt/disabled browser storage is optional. */ }
}
restoreMetricHistory();
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide',persistMetricHistory);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)persistMetricHistory();});
}

/**
 * Mean of a metric series over samples where the reading is > 0, or null when
 * there are no busy samples. Skipping zeros keeps idle/off phases from dragging
 * the average toward zero (a prefill that runs at 500 tok/s is "500", not 0.5).
 */
export function avgPositive(values: readonly number[]): number | null {
  let sum = 0;
  let count = 0;
  for (const v of values) {
    if (v > 0) {
      sum += v;
      count += 1;
    }
  }
  return count > 0 ? sum / count : null;
}

function notify() {
  for (const l of listeners) l();
}

export function subscribeMetrics(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setHistoryTail(key: string, full: number[]) {
  if (full.length === 0) {
    historyTails.delete(key);
    return;
  }
  // Share the full ref when short enough — one allocation, both hooks see the same array.
  historyTails.set(key, full.length <= SPARKLINE_TAIL ? full : full.slice(-SPARKLINE_TAIL));
}

function pushHistory(key: string, value: number, at: number, capacity = HISTORY_MAX) {
  if(typeof value !== 'number' || !Number.isFinite(value)) return;
  let ring = history.get(key);
  if (!ring) {
    ring = new TimedRingBuffer(capacity);
    history.set(key, ring);
  }
  const last = ring.last();
  if (last && at < last.at) return;
  if (last && at === last.at) ring.replaceLast({ at, value });
  else ring.push({ at, value });
  ring.pruneBefore(at - (capacity === HISTORY_MAX ? HISTORY_HOURS * 3_600_000 : 60_000));
  const samples = ring.toArray();
  historySamples.set(key, samples);
  historyValues.set(key, samples.map((sample) => sample.value));
  setHistoryTail(key, ring.tail(SPARKLINE_TAIL).map((sample) => sample.value));
}

function removeHistoryForSpark(sparkId: string) {
  const prefix = `${sparkId}:`;
  for(const key of llmIdentities.keys())if(key.startsWith(prefix))llmIdentities.delete(key);
  for (const key of history.keys()) {
    if (key.startsWith(prefix)) {
      history.delete(key);
      historySamples.delete(key);
      historyValues.delete(key);
      historyTails.delete(key);
    }
  }
}

/** Ingest a full WS snapshot: update latest-per-spark + append history series. */
export function ingestSnapshots(sparks: SparkSnapshot[], at = Date.now()): boolean {
  // Reject the entire stale frame before model identity, current snapshots or
  // registry membership can erase a newer history. Per-series guards are too late.
  if (!Number.isFinite(at) || at < lastSnapshotAt) return false;
  lastSnapshotAt = at;
  const alive = new Set<string>();

  for (const s of sparks) {
    alive.add(s.id);
    sparkMap.set(s.id, s);
    if (!s.online) continue; // don't record zero-samples for offline hosts
    const m = s.metrics;
    if (m.gpu) {
      pushHistory(`${s.id}:gpu.usage`, m.gpu.usage, at);
      pushHistory(`${s.id}:gpu.temp`, m.gpu.temperature, at);
      const watts = m.gpu.power?.draw;
      if (typeof watts === 'number' && Number.isFinite(watts) && watts >= 0) {
        // Small browser-only trace, bounded to 60 points / one minute.
        pushHistory(`${s.id}:gpu.power`, watts, at, 60);
      }
    }
    if (m.cpu) {
      pushHistory(`${s.id}:cpu.usage`, m.cpu.usage, at);
      // Skip 0°C so a missing sensor does not draw a fake floor on the sparkline.
      if (m.cpu.temperature > 0) {
        pushHistory(`${s.id}:cpu.temp`, m.cpu.temperature, at);
      }
    }
    if (m.ram) {
      pushHistory(`${s.id}:ram.percentage`, m.ram.percentage, at);
    }
    if (Array.isArray(m.llm)) {
      // Zip with snapshot.llmPorts so multi-port LLM series key distinctly.
      const ports = s.llmPorts ?? [];
      for (let i = 0; i < m.llm.length; i++) {
        const llm = m.llm[i];
        const port = ports[i];
        const portKey = port != null ? `:${port}` : `:${i}`;
        const prefix=`${s.id}:llm${portKey}`;
        if(llm.backend && llm.modelId){
          const identity=JSON.stringify([llm.backend,llm.modelId]);
          const previous=llmIdentities.get(prefix);
          if(previous && previous!==identity){
            for(const store of [history,historySamples,historyValues,historyTails]){
              for(const key of store.keys())if(key.startsWith(prefix+'.'))store.delete(key);
            }
          }
          llmIdentities.set(prefix,identity);
        }
        if(!llm.available)continue;
        pushHistory(`${s.id}:llm${portKey}.tps`, llm.generationTps, at);
        pushHistory(`${s.id}:llm${portKey}.prefill`, llm.prefillTps, at);
        // TTFT is sparse: vLLM reports live TTFT only while serving. It is NOT
        // index-aligned with the tick-dense series above — that is fine because
        // the ttft series feeds only the busy-sample average badge, never the
        // overlaid chart (see LlmTrendChart).
        if (llm.ttftSeconds != null) {
          pushHistory(`${s.id}:llm${portKey}.ttft`, llm.ttftSeconds, at);
        }
        if (llm.cachedPrefillTps != null) {
          pushHistory(`${s.id}:llm${portKey}.prefillCached`, llm.cachedPrefillTps, at);
        }
        if (llm.uncachedPrefillTps != null) {
          pushHistory(`${s.id}:llm${portKey}.prefillUncached`, llm.uncachedPrefillTps, at);
        }
      }
    }
    if (m.comfy?.available) {
      pushHistory(`${s.id}:comfy.queue`, (m.comfy.queueRunning ?? 0) + (m.comfy.queuePending ?? 0), at);
    }
  }

  // Drop series for Sparks no longer in the registry (deleted / removed from WS).
  for (const id of [...sparkMap.keys()]) {
    if (!alive.has(id)) {
      sparkMap.delete(id);
      removeHistoryForSpark(id);
    }
  }
  // Restored browser series have no snapshot in sparkMap yet. Remove cached
  // entries absent from the first authoritative registry frame as well.
  const prefixes=[...alive].map(id=>`${id}:`);
  for(const store of [history,historySamples,historyValues,historyTails,llmIdentities]){
    for(const key of store.keys())if(!prefixes.some(prefix=>key.startsWith(prefix)))store.delete(key);
  }

  // Always notify: sparkMap refs refresh every frame (online flips included),
  // even when no history sample was appended.
  notify();
  if (Date.now()-lastSaved>=5000) persistMetricHistory();
  return true;
}

/** Read the latest cached snapshot for a spark (subscribe via useSpark). */
export function getSpark(id: string): SparkSnapshot | undefined {
  return sparkMap.get(id);
}

/** @internal getSnapshot for useMetricsHistory — stable ref per key. */
function getHistory(key: string): readonly number[] {
  return historyValues.get(key) ?? EMPTY;
}

const EMPTY_TIMED: readonly TimedSample[] = Object.freeze([] as TimedSample[]);

export type MetricSample = TimedSample;

export function getMetricHistorySamples(sparkId: string, metric: string): readonly TimedSample[] {
  return historySamples.get(`${sparkId}:${metric}`) ?? EMPTY_TIMED;
}

function getTimedHistory(key: string): readonly TimedSample[] {
  return historySamples.get(key) ?? EMPTY_TIMED;
}

function getHistoryTail(key: string): readonly number[] {
  return historyTails.get(key) ?? EMPTY;
}

/**
 * Subscribe to one metric's full history series for one spark (up to HISTORY_MAX).
 * Re-renders only when that specific (sparkId, metric) array ref changes.
 */
export function useMetricsHistory(sparkId: string, metric: string): readonly number[] {
  const key = `${sparkId}:${metric}`;
  return useSyncExternalStore(
    subscribeMetrics,
    () => getHistory(key),
    () => EMPTY
  );
}

export function useTimedMetricsHistory(sparkId: string, metric: string): readonly TimedSample[] {
  const key = `${sparkId}:${metric}`;
  return useSyncExternalStore(
    subscribeMetrics,
    () => getTimedHistory(key),
    () => EMPTY_TIMED
  );
}

/**
 * Last SPARKLINE_TAIL samples for inline sparklines. Prefer this over slicing
 * the full series in render — the tail ref is maintained at ingest time.
 */
export function useMetricsHistoryTail(sparkId: string, metric: string): readonly number[] {
  const key = `${sparkId}:${metric}`;
  return useSyncExternalStore(
    subscribeMetrics,
    () => getHistoryTail(key),
    () => EMPTY
  );
}

/**
 * Subscribe to one spark's latest snapshot. Re-renders when that spark's
 * cached object is replaced (every WS frame that includes it).
 */
export function useSpark(id: string): SparkSnapshot | undefined {
  return useSyncExternalStore(
    subscribeMetrics,
    () => sparkMap.get(id),
    () => undefined
  );
}

/** Clear all cached state — used on hard reload paths / tests. */
export function _resetStore(): void {
  lastSnapshotAt = -Infinity;
  llmIdentities.clear();
  history.clear();
  historySamples.clear();
  historyValues.clear();
  historyTails.clear();
  sparkMap.clear();
}
