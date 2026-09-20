import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SparkTabs } from "./SparkTabs";
import { makeSpark } from "../testing/fixtures";
import { render } from "../testing/render";

function mockWidth(width: number) {
  vi.stubGlobal("innerWidth", width);
}

afterEach(() => vi.unstubAllGlobals());

describe("SparkTabs accessibility and scale", () => {
  it("marks the current desktop tab for assistive tech", () => {
    mockWidth(1440);
    const sparks = [makeSpark("a"), makeSpark("b")];
    const { container } = render(
      <SparkTabs sparks={sparks} activeId="b" onSelect={() => {}} onAdd={() => {}} />
    );
    const current = container.querySelector('[aria-current="page"]');
    expect(current?.textContent).toContain("Spark b");
    expect(container.querySelectorAll(".pill-item-with-handle, .pill-item")).toHaveLength(3);
  });

  it("keeps 4/8/12-node desktop navigation in a horizontally overflowable nav", () => {
    mockWidth(1024);
    for (const count of [4, 8, 12] as const) {
      const sparks = Array.from({ length: count }, (_, index) => makeSpark(`n${index}`));
      const { container } = render(
        <SparkTabs sparks={sparks} activeId={`n${count - 1}`} onSelect={() => {}} onAdd={() => {}} />
      );
      const nav = container.querySelector("nav");
      expect(nav).not.toBeNull();
      expect(container.querySelectorAll(".pill-item-with-handle")).toHaveLength(count);
      expect(container.querySelector('[aria-current="page"]')?.textContent).toContain(`Spark n${count - 1}`);
    }
  });

  it("exposes the mobile menu as an expandable list of 12 nodes", () => {
    mockWidth(320);
    const sparks = Array.from({ length: 12 }, (_, index) => makeSpark(`m${index}`));
    const { container } = render(
      <SparkTabs sparks={sparks} activeId="m3" onSelect={() => {}} onAdd={() => {}} />
    );
    const toggle = container.querySelector('button[aria-label="选择 Spark"]') as HTMLButtonElement;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(14);
    expect(document.querySelector('#mobile-spark-menu [aria-current="page"]')?.textContent).toContain("Spark m3");
    expect(document.activeElement?.textContent).toContain('Spark m3');
    act(() => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    expect(document.activeElement?.textContent).toContain('Spark m4');
    act(() => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('#mobile-spark-menu')).toBeNull();
    expect(document.activeElement).toBe(toggle);
    act(() => toggle.click());
    const menu = document.querySelector('#mobile-spark-menu') as HTMLElement;
    expect(menu.parentElement).toBe(document.body);
    expect(parseFloat(menu.style.left)).toBe(0);
    expect(parseFloat(menu.style.left) + parseFloat(menu.style.width)).toBeLessThanOrEqual(308);
    act(() => toggle.click());
    expect(document.querySelector('#mobile-spark-menu')).toBeNull();
  });
});
