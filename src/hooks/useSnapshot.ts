import { useEffect, useRef, useState, useCallback } from "react";
import type { SparkSnapshot, WsSnapshot } from "../api/types";
import { ingestSnapshots } from "./metricsStore";
import { OVERVIEW_ID } from "../constants";
import { validSnapshots } from './snapshotValidation';
import { activeIdFromPath } from './useRoute';
import { readAccessToken } from '../api/browserStorage';
import { createConnectivityReporter } from './connectivityReporter';

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
  const leavingPage = useRef(false);
  const diagnostics = useRef<ReturnType<typeof createConnectivityReporter> | null>(null);
  const receivedSignature = useRef('');
  const appliedSignature = useRef('');
  const latestFrame = useRef<{generatedAt?:number;serverBootId?:string}>({});

  // ─── Connect ─────────────────────────────────────────────
  const connect = useCallback(() => {
    if (!shouldReconnect.current || leavingPage.current) return;

    const state = wsRef.current?.readyState;
    // Avoid duplicate sockets while OPEN or still CONNECTING
    if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return;

    const token = readAccessToken();
    const url = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ""}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    // A new transport needs its own first-valid-data evidence, even when
    // node states and server generation are identical to the prior socket.
    receivedSignature.current = '';
    appliedSignature.current = '';

    ws.onopen = () => {
      if (wsRef.current !== ws || !shouldReconnect.current || leavingPage.current) return;
      // A socket alone is not healthy; wait for one valid snapshot.
      setConnected(false);
      console.log("[ws] connected");
      diagnostics.current?.record('ws_open');
    };

    ws.onmessage = (ev) => {
      if (wsRef.current !== ws || !shouldReconnect.current || leavingPage.current) return;
      try {
        const msg: WsSnapshot = JSON.parse(ev.data);
        if (msg?.type === "snapshot" && validSnapshots(msg.sparks) && (msg.generatedAt == null || Number.isFinite(msg.generatedAt))) {
          const receivedAt = Date.now();
          latestFrame.current = {generatedAt:msg.generatedAt,serverBootId:msg.bootId};
          const states=msg.sparks.map(s=>({id:s.id,online:s.online}));
          const signature=JSON.stringify([msg.bootId,states]);
          if(signature!==receivedSignature.current){
            receivedSignature.current=signature;
            diagnostics.current?.record('snapshot_received',{...latestFrame.current,states});
          }
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
          diagnostics.current?.record('invalid_snapshot');
          setSnapshotError("服务器返回了无效的遥测数据，保留上次有效快照。");
        }
      } catch {
        diagnostics.current?.record('invalid_snapshot');
        setSnapshotError("服务器返回的遥测数据格式错误，保留上次有效快照。");
      }
    };

    ws.onclose = (event) => {
      if (wsRef.current !== ws) return;
      diagnostics.current?.record('ws_close',{closeCode:event?.code,leavingPage:leavingPage.current,...latestFrame.current});
      wsRef.current = null;
      // Firefox closes WebSockets between beforeunload and pagehide. The old
      // document is still visible then; do not paint a false disconnect banner.
      if (!shouldReconnect.current || leavingPage.current) return;
      setConnected(false);
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY);
    };

    ws.onerror = () => {
      if (wsRef.current !== ws || !shouldReconnect.current || leavingPage.current) return;
      diagnostics.current?.record('ws_error',{leavingPage:leavingPage.current,...latestFrame.current});
      ws.close();
    };
  }, []);

  // ─── Lifecycle ───────────────────────────────────────────
  useEffect(() => {
    diagnostics.current = createConnectivityReporter();
    shouldReconnect.current = true;
    leavingPage.current = false;
    let hidden = false;
    const resume = () => {
      if (hidden || !shouldReconnect.current) return;
      leavingPage.current = false;
      const state = wsRef.current?.readyState;
      if (state !== WebSocket.OPEN && state !== WebSocket.CONNECTING) {
        setConnected(false);
        connect();
      }
    };
    const beforeUnload = () => {
      leavingPage.current = true;
      clearTimeout(reconnectTimer.current);
      // A timer cannot distinguish a cancelled navigation from a slow reload.
      // Resume on page restoration or when the user returns/interacts instead.
    };
    const pageHide = () => {
      diagnostics.current?.record('pagehide',{leavingPage:true,...latestFrame.current});
      hidden = true;
      leavingPage.current = true;
      clearTimeout(reconnectTimer.current);
      const ws = wsRef.current;
      wsRef.current = null;
      ws?.close();
    };
    const pageShow = () => { diagnostics.current?.record('pageshow'); hidden = false; resume(); };
    const returnToPage = () => { if (leavingPage.current && !hidden) resume(); };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('pagehide', pageHide);
    window.addEventListener('pageshow', pageShow);
    window.addEventListener('focus', returnToPage);
    window.addEventListener('pointerdown', returnToPage);
    window.addEventListener('keydown', returnToPage);
    connect();
    return () => {
      shouldReconnect.current = false;
      leavingPage.current = true;
      diagnostics.current?.dispose();
      diagnostics.current=null;
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('pagehide', pageHide);
      window.removeEventListener('pageshow', pageShow);
      window.removeEventListener('focus', returnToPage);
      window.removeEventListener('pointerdown', returnToPage);
      window.removeEventListener('keydown', returnToPage);
      clearTimeout(reconnectTimer.current);
      const ws = wsRef.current;
      if (ws) {
        ws.onopen = null;
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        ws.close();
      }
      wsRef.current = null;
    };
  }, [connect]);

  useEffect(() => {
    if(!sparks.length)return;
    const states=sparks.map(s=>({id:s.id,online:s.online}));
    const signature=JSON.stringify([latestFrame.current.serverBootId,states]);
    if(signature!==appliedSignature.current){
      appliedSignature.current=signature;
      diagnostics.current?.record('snapshot_applied',{...latestFrame.current,states});
    }
  },[sparks]);

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
