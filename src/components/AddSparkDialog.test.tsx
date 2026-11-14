import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddSparkDialog } from "./AddSparkDialog";
import { render, flush } from "../testing/render";
import { addSpark, testSparkConfig } from "../api/client";

function input(selector: string, value: string) {
  act(() => {
    const field = document.querySelector(selector)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function button(label: string) {
  return [...document.querySelectorAll("button")].find(b => b.textContent === label)!;
}
function fill() {
  input('input[placeholder="我的 Spark"]', '测试主机');
  input('input[placeholder="192.168.1.100"]', '192.168.1.100');
}

vi.mock("../api/client", () => ({
  addSpark: vi.fn(),
  testSparkConfig: vi.fn(),
}));

class MemoryWebSocket {
  static instances: MemoryWebSocket[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readyState = 0;
  constructor(public url: string) {
    MemoryWebSocket.instances.push(this);
  }
  send() {}
  close() {
    this.readyState = 3;
    this.onclose?.(new CloseEvent("close"));
  }
}

describe("AddSparkDialog keyboard contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("WebSocket", MemoryWebSocket);
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { protocol: "http:", host: "localhost:5555" },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("is a modal dialog that closes on Escape", () => {
    const onClose = vi.fn();
    render(<AddSparkDialog open onClose={onClose} onAdded={() => {}} />);
    const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-labelledby")).toBe("add-spark-title");
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(onClose).toHaveBeenCalled();
  });

  it("preserves port typing and rejects partial or out-of-range numbers", () => {
    render(<AddSparkDialog open onClose={() => {}} onAdded={() => {}} />);
    fill();
    for (const value of ['8888,', '8888oops', '0', '65536', '1.5']) {
      input('[aria-label="模型端口"]', value);
      expect((document.querySelector('[aria-label="模型端口"]') as HTMLInputElement).value).toBe(value);
      expect(button('保存').disabled).toBe(true);
      expect(button('测试连接').disabled).toBe(true);
      expect(document.querySelector('[role="alert"]')?.textContent).toContain('1–65535');
    }
    input('[aria-label="模型端口"]', '8888, 9000');
    expect(button('保存').disabled).toBe(false);
  });

  it("serializes unique ports and blocks dismissal or testing during save", async () => {
    let finish!: () => void;
    vi.mocked(addSpark).mockReturnValue(new Promise(resolve => { finish = () => resolve({} as never); }));
    const close = vi.fn();
    render(<AddSparkDialog open onClose={close} onAdded={() => {}} />);
    fill(); input('[aria-label="模型端口"]', '8888, 9000, 8888');
    act(() => button('保存').click()); await flush();
    expect(vi.mocked(addSpark).mock.calls[0][0].llmPorts).toEqual([8888, 9000]);
    expect(document.querySelector('fieldset')?.disabled).toBe(true);
    expect(button('取消').disabled).toBe(true);
    expect(button('测试连接').disabled).toBe(true);
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(close).not.toHaveBeenCalled(); expect(testSparkConfig).not.toHaveBeenCalled();
    await act(async () => finish()); expect(close).toHaveBeenCalledOnce();
  });

  it("uses the configured default for an empty port field and preserves failed drafts", async () => {
    vi.mocked(addSpark).mockRejectedValueOnce(new Error('保存结果未确认'));
    const close = vi.fn();
    render(<AddSparkDialog open defaultLlmPort={9001} onClose={close} onAdded={() => {}} />);
    fill(); input('[aria-label="模型端口"]', '');
    act(() => button('保存').click()); await flush();
    expect(vi.mocked(addSpark).mock.calls[0][0].llmPorts).toEqual([9001]);
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('保存结果未确认');
    expect(close).not.toHaveBeenCalled(); expect(button('保存').disabled).toBe(false);
  });
});
