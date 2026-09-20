import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetStore, getMetricHistorySamples } from "./metricsStore";
import { useSnapshot } from "./useSnapshot";
import { makeSpark } from "../testing/fixtures";
import { flush, render } from "../testing/render";

class MockSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances: MockSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    MockSocket.instances.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  emit(data: unknown) {
    this.onmessage?.({ data: typeof data === "string" ? data : JSON.stringify(data) });
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

function Probe() {
  const snapshot = useSnapshot();
  return (
    <pre data-testid="probe">
      {JSON.stringify({
        connected: snapshot.connected,
        error: snapshot.snapshotError,
        last: snapshot.lastValidSnapshotAt,
        count: snapshot.sparks.length,
      })}
    </pre>
  );
}

function readProbe() {
  return JSON.parse(document.querySelector("[data-testid=probe]")!.textContent || "{}");
}

describe("useSnapshot connection lifecycle", () => {
  it('keeps the last good snapshot and history when throughput is corrupt', () => {
    render(<Probe/>);const socket=MockSocket.instances[0];
    act(()=>{socket.open();socket.emit({type:'snapshot',generatedAt:50000,sparks:[makeSpark('head')]});});
    const before=getMetricHistorySamples('head','llm:8888.tps');
    const invalid=makeSpark('head');
    Object.assign(invalid.metrics.llm[0],{generationTps:null});
    act(()=>socket.emit({type:'snapshot',generatedAt:50001,sparks:[invalid]}));
    expect(readProbe()).toMatchObject({count:1,last:50000});
    expect(readProbe().error).toContain('无效');
    expect(getMetricHistorySamples('head','llm:8888.tps')).toEqual(before);
    expect(before.length).toBeGreaterThan(0);
  });
  beforeEach(() => {
    _resetStore();
    MockSocket.instances = [];
    vi.stubGlobal("WebSocket", MockSocket);
    vi.useFakeTimers();
    vi.setSystemTime(50_000);
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { protocol: "http:", host: "localhost:5555" },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it('connects safely when token storage is denied', () => {
    vi.stubGlobal('localStorage',{getItem:()=>{throw new DOMException('Denied','SecurityError');}});
    expect(()=>render(<Probe/>)).not.toThrow();expect(MockSocket.instances[0].url).toBe('ws://localhost:5555/ws');
  });

  it('records received and applied offline/recovery states with the server generation', async () => {
    sessionStorage.clear();
    const send=vi.fn().mockResolvedValue({ok:true,status:202});vi.stubGlobal('fetch',send);
    render(<Probe/>);const socket=MockSocket.instances[0];
    act(()=>{socket.open();socket.emit({type:'snapshot',bootId:'boot-one',generatedAt:50000,sparks:[makeSpark('worker-fixture',false)]});});
    await flush();
    act(()=>socket.emit({type:'snapshot',bootId:'boot-two',generatedAt:50001,sparks:[makeSpark('worker-fixture',true)]}));
    await flush();await flush();
    const events=send.mock.calls.map(c=>JSON.parse(c[1].body));
    for(const kind of ['snapshot_received','snapshot_applied']){
      expect(events.some(e=>e.kind===kind&&e.serverBootId==='boot-one'&&e.states[0].online===false)).toBe(true);
      expect(events.some(e=>e.kind===kind&&e.serverBootId==='boot-two'&&e.states[0].online===true)).toBe(true);
    }
  });

  it('records the first valid data again after reconnect with unchanged node states', async () => {
    sessionStorage.clear();
    const send=vi.fn().mockResolvedValue({ok:true,status:202});vi.stubGlobal('fetch',send);
    render(<Probe/>);
    const frame={type:'snapshot',bootId:'same-server',generatedAt:50000,sparks:[makeSpark('worker-fixture',true)]};
    act(()=>{MockSocket.instances[0].open();MockSocket.instances[0].emit(frame);});
    await flush();await flush();
    act(()=>{MockSocket.instances[0].close();vi.advanceTimersByTime(2100);});
    act(()=>MockSocket.instances[1].open());
    expect(readProbe().connected).toBe(false);
    act(()=>MockSocket.instances[1].emit({...frame,generatedAt:52100}));
    await flush();await flush();
    const events=send.mock.calls.map(c=>JSON.parse(c[1].body));
    expect(events.filter(e=>e.kind==='snapshot_received')).toHaveLength(2);
    expect(events.filter(e=>e.kind==='snapshot_applied')).toHaveLength(2);
    expect(readProbe().connected).toBe(true);
  });

  it('does not turn a normal refresh into a disconnect and reconnects after page restoration', () => {
    render(<Probe />);
    const first = MockSocket.instances[0];
    act(() => { first.open(); first.emit({type:'snapshot',sparks:[makeSpark('alpha')]}); });
    const lateOpen = first.onopen;
    const lateClose = first.onclose;
    act(() => {
      window.dispatchEvent(new Event('beforeunload'));
      first.close();
    });
    expect(readProbe().connected).toBe(true);
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
      vi.advanceTimersByTime(5000);
    });
    expect(MockSocket.instances).toHaveLength(1);
    act(() => window.dispatchEvent(new Event('pageshow')));
    expect(MockSocket.instances).toHaveLength(2);
    const next = MockSocket.instances[1];
    act(() => { next.open(); next.emit({type:'snapshot',sparks:[makeSpark('alpha')]}); });
    act(() => { lateOpen?.(); lateClose?.(); });
    expect(readProbe().connected).toBe(true);
    act(() => vi.advanceTimersByTime(3000));
    expect(MockSocket.instances).toHaveLength(2);
  });

  it('recovers if navigation is cancelled rather than hiding a closed socket forever', () => {
    render(<Probe />);
    const first = MockSocket.instances[0];
    act(() => { first.open(); first.emit({type:'snapshot',sparks:[makeSpark('alpha')]}); });
    act(() => { window.dispatchEvent(new Event('beforeunload')); first.close(); });
    expect(readProbe().connected).toBe(true);
    act(() => vi.advanceTimersByTime(1000));
    expect(readProbe().connected).toBe(true);
    act(() => window.dispatchEvent(new Event('focus')));
    expect(readProbe().connected).toBe(false);
    expect(MockSocket.instances).toHaveLength(2);
  });

  it('does not reconnect or flash a disconnect during a slow page departure', () => {
    render(<Probe />);
    const socket=MockSocket.instances[0];
    act(()=>{socket.open();socket.emit({type:'snapshot',sparks:[makeSpark('alpha')]});});
    act(()=>{window.dispatchEvent(new Event('beforeunload'));socket.close();vi.advanceTimersByTime(10000);});
    expect(readProbe().connected).toBe(true);
    expect(MockSocket.instances).toHaveLength(1);
    act(()=>window.dispatchEvent(new Event('pointerdown')));
    expect(MockSocket.instances).toHaveLength(2);
    expect(readProbe().connected).toBe(false);
  });

  it("stays disconnected until a valid snapshot, then recovers after disconnect and malformed data", async () => {
    render(<Probe />);
    const socket = MockSocket.instances[0];
    act(() => socket.open());
    await flush();
    expect(readProbe().connected).toBe(false);

    act(() => socket.emit({
      type: "snapshot",
      generatedAt: 50_000,
      refreshInterval: 2000,
      sparks: [makeSpark("alpha")],
    }));
    await flush();
    expect(readProbe()).toMatchObject({ connected: true, count: 1, error: null, last: 50_000 });
    expect(getMetricHistorySamples("alpha", "gpu.usage")[0]).toEqual({ at: 50_000, value: 42 });

    const invalid = {...makeSpark('bad'),telemetry:{}};
    act(() => socket.emit({type:'snapshot',generatedAt:50_001,sparks:[invalid]}));
    await flush();
    expect(readProbe()).toMatchObject({count:1,last:50_000});
    expect(readProbe().error).toContain('无效');
    expect(getMetricHistorySamples('bad','gpu.usage')).toEqual([]);

    act(() => socket.close());
    await flush();
    expect(readProbe().connected).toBe(false);
    expect(readProbe().count).toBe(1);

    act(() => vi.advanceTimersByTime(2000));
    const next = MockSocket.instances[1];
    act(() => next.open());
    act(() => next.emit("not-json"));
    await flush();
    expect(readProbe().error).toContain("格式错误");
    expect(readProbe().connected).toBe(false);

    act(() => next.emit({ type: "snapshot", generatedAt: 51_000, refreshInterval: 2000, sparks: [makeSpark("alpha")] }));
    await flush();
    expect(readProbe()).toMatchObject({ connected: true, error: null });
    expect(readProbe().last).toBeGreaterThanOrEqual(50_000);
  });
});
