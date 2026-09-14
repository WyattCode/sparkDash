import { useEffect, useRef, useState, useCallback } from "react";
import type { SparkSnapshot, WsSnapshot } from "../api/types";
import { ingestSnapshots } from "./metricsStore";
import { OVERVIEW_ID } from "../constants";
import { validSnapshots } from './snapshotValidation';
import { activeIdFromPath } from './useRoute';
import { readAccessToken } from '../api/browserStorage';

const RECONNECT_DELAY = 2000;

/**
 * useSnapshot — connects to the WebSocket and exposes live spark data.
 * Returns { sparks, activeId, setActiveId, activeSpark, connected }.
 */
export function useSnapshot() {
  const [sparks, setSparks] = useState<SparkSnapshot[]>([]);
  const [connected, setConnected] = useState(false);
  const [lastValidSnapshotAt, setLastValidSnapshotAt] = useState<number | null>(null);
  const [snapshotGeneratedAt, setSnapshotGeneratedAt] = useState<number | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [refreshInterval, setRefreshInterval] = useState<number | null>(null);
  const [activeId, setActiveId] = useState<string | null>(() => activeIdFromPath(location.pathname));
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** When false, onclose must not schedule reconnect (unmount / intentional close). */
  const shouldReconnect = useRef(true);

  // ─── Connect ─────────────────────────────────────────────
  const connect = useCallback(() => {
    if (!shouldReconnect.current) return;

    const state = wsRef.current?.readyState;
    // Avoid duplicate sockets while OPEN or still CONNECTING
    if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return;

    const token = readAccessToken();
    const url = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ""}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      // A socket alone is not healthy; wait for one valid snapshot.
      setConnected(false);
      console.log("[ws] connected");
    };

    ws.onmessage = (ev) => {
      try {
        const msg: WsSnapshot = JSON.parse(ev.data);
        if (msg?.type === "snapshot" && validSnapshots(msg.sparks) && (msg.generatedAt == null || Number.isFinite(msg.generatedAt))) {
          const receivedAt = Date.now();
          // Feed the central history store (8b) before notifying React state.
          ingestSnapshots(msg.sparks, msg.generatedAt ?? receivedAt);
          setSparks(msg.sparks);
          setConnected(true);
          setLastValidSnapshotAt(receivedAt);
          setSnapshotGeneratedAt(
            Number.isFinite(msg.generatedAt) ? Number(msg.generatedAt) : null
          );
          setRefreshInterval(
            Number.isFinite(msg.refreshInterval) ? Number(msg.refreshInterval) : null
          );
          setSnapshotError(null);
          // Default to the Overview tab; keep the current selection if it
          // is still valid (Overview is always valid).
          setActiveId((prev) => {
            if (prev === OVERVIEW_ID) return OVERVIEW_ID;
            if (prev && msg.sparks.some((s) => s.id === prev)) return prev;
            return OVERVIEW_ID;
          });
        } else {
          setSnapshotError("服务器返回了无效的遥测数据，保留上次有效快照。");
        }
      } catch {
        setSnapshotError("服务器返回的遥测数据格式错误，保留上次有效快照。");
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      if (!shouldReconnect.current) return;
      reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  // ─── Lifecycle ───────────────────────────────────────────
  useEffect(() => {
    shouldReconnect.current = true;
    connect();
    return () => {
      shouldReconnect.current = false;
      clearTimeout(reconnectTimer.current);
      const ws = wsRef.current;
      if (ws) {
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        ws.close();
      }
      wsRef.current = null;
    };
  }, [connect]);

  // ─── Derived state ──────────────────────────────────────
  const activeSpark = sparks.find((s) => s.id === activeId) || null;

  return {
    sparks,
    connected,
    activeId,
    setActiveId,
    activeSpark,
    lastValidSnapshotAt,
    snapshotGeneratedAt,
    snapshotError,
    refreshInterval,
  };
}
