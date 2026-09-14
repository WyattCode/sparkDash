import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { ConnectionBanner } from "./ConnectionBanner";
import { ErrorBanner } from "./ErrorBanner";
import { render } from "../../testing/render";

describe("operator status banners", () => {
  it("keeps last-known data explicitly disconnected and announces once without age chatter", () => {
    const { container } = render(
      <ConnectionBanner connected={false} lastValidSnapshotAt={10_000} snapshotError={null} now={25_000} stale={false} />
    );
    expect(container.textContent).toContain("正在显示 15s 前的数据");
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toBe("实时遥测已断开。");
  });

  it("distinguishes stale and malformed telemetry", () => {
    const stale = render(
      <ConnectionBanner connected lastValidSnapshotAt={10_000} snapshotError={null} now={21_000} stale />
    ).container;
    expect(stale.textContent).toContain("遥测数据已过期");
    const malformed = render(
      <ConnectionBanner connected={false} lastValidSnapshotAt={10_000} snapshotError="Malformed telemetry" now={21_000} stale />
    ).container;
    expect(malformed.textContent).toContain("Malformed telemetry");
    expect(malformed.querySelector('[role="status"]')?.textContent).toBe("遥测数据错误。");
  });

  it("renders a dismissible action error as an alert", () => {
    const dismiss = vi.fn();
    const { container } = render(<ErrorBanner message="Could not save order" onDismiss={dismiss} />);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Could not save order");
    act(() => (container.querySelector('button[aria-label="关闭错误提示"]') as HTMLButtonElement).click());
    expect(dismiss).toHaveBeenCalledOnce();
  });
});
