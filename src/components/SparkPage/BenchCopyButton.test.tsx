/**
 * The dialogs' copy control: off it is the plain text button, on it is a split
 * button whose label copies text and whose caret offers the image.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { render } from "../../testing/render";
import type { ShareCardModel } from "./benchShareCard";
import { BenchCopyButton } from "./BenchCopyButton";
import { canCopyImages, copyCardImage, copyTextOnly, renderCardObjectUrl } from "./shareImage";

vi.mock("./shareImage", () => ({
  copyTextOnly: vi.fn(async () => {}),
  copyCardImage: vi.fn(async () => "copied"),
  renderCardObjectUrl: vi.fn(async () => "blob:card"),
  // Default: a secure context, so the menu offers the clipboard.
  canCopyImages: vi.fn(() => true),
}));

const card: ShareCardModel = {
  brand: "sparkDash",
  host: "spark-38bd",
  title: "Decode benchmark",
  subtitle: "Port 8888",
  status: { label: "COMPLETED", tone: "ok" },
  meta: "Prose · 400 tok",
  columns: { load: "Load", primary: "Aggregate", secondary: "Stream" },
  rows: [],
  legend: "Aggregate — …",
  footer: "github.com/MiaAI-Lab/sparkDash",
  generatedAt: Date.UTC(2026, 8, 17),
};

function mount(shareImage: boolean, onError = vi.fn()) {
  const { container } = render(
    <BenchCopyButton
      text="summary text"
      buildCard={() => card}
      kind="decode"
      shareImage={shareImage}
      onError={onError}
    />
  );
  return { root: container as HTMLElement, onError };
}

const buttons = (root: HTMLElement) => Array.from(root.querySelectorAll("button"));
/** The menu is portalled out of the dialog (the sheet clips its overflow). */
const menuEl = () => document.querySelector('[role="menu"]') as HTMLElement | null;
const menuItems = () =>
  Array.from(document.querySelectorAll('[role="menuitem"]')).map((i) => (i.textContent || "").trim());
const byText = (root: HTMLElement, text: string) =>
  buttons(root).find((b) => (b.textContent || "").trim() === text);
const click = (el: Element) => act(() => (el as HTMLButtonElement).click());

afterEach(() => {
  vi.mocked(copyTextOnly).mockClear();
  vi.mocked(copyCardImage).mockClear();
  vi.mocked(canCopyImages).mockReturnValue(true);
  vi.mocked(renderCardObjectUrl).mockResolvedValue("blob:card");
});

describe("with the share image off", () => {
  it("is exactly the old text button", () => {
    const { root } = mount(false);
    const labels = buttons(root).map((b) => (b.textContent || "").trim());
    expect(labels).toEqual(["复制结果"]);
    expect(root.querySelector('[aria-haspopup="menu"]')).toBeNull();
  });

  it("copies the text and reports it the way it always did", async () => {
    const { root } = mount(false);
    await act(async () => byText(root, "复制结果")!.click());
    expect(copyTextOnly).toHaveBeenCalledWith("summary text");
    expect(copyCardImage).not.toHaveBeenCalled();
    expect((byText(root, "已复制！")?.textContent || "").trim()).toBe("已复制！");
  });
});

describe("with the share image on", () => {
  it("defaults the label to text and hides the menu until asked", () => {
    const { root } = mount(true);
    expect(byText(root, "复制结果")).toBeTruthy();
    expect(menuEl()).toBeNull();
    expect(root.querySelector('[aria-haspopup="menu"]')?.getAttribute("aria-expanded")).toBe("false");
  });

  it("copies text from the label and says which format went out", async () => {
    const { root } = mount(true);
    await act(async () => byText(root, "复制结果")!.click());
    expect(copyTextOnly).toHaveBeenCalledWith("summary text");
    expect(byText(root, "文本已复制！")).toBeTruthy();
  });

  it("opens the format menu from the caret and copies the image", async () => {
    const { root } = mount(true);
    const caret = root.querySelector('[aria-haspopup="menu"]')!;
    click(caret);
    expect(menuEl()).toBeTruthy();
    expect(caret.getAttribute("aria-expanded")).toBe("true");
    expect(menuItems()).toEqual(["复制为文本", "复制为图片"]);

    const imageItem = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
      (el) => (el.textContent || "").trim() === "复制为图片"
    )!;
    await act(async () => (imageItem as HTMLButtonElement).click());
    expect(copyCardImage).toHaveBeenCalledTimes(1);
    expect(copyTextOnly).not.toHaveBeenCalled();
    expect(byText(root, "图片已复制！")).toBeTruthy();
    expect(menuEl()).toBeNull();
  });

  it('keeps keyboard focus inside the portalled menu and restores the caret on Escape', () => {
    const { root } = mount(true);
    const caret = root.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
    click(caret);
    const items = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    expect(document.activeElement).toBe(items[0]);
    act(()=>items[0].dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true})));
    expect(document.activeElement).toBe(items.at(-1));
    act(()=>document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true})));
    expect(document.activeElement).toBe(items[0]);
    act(()=>items[0].dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true})));
    expect(document.activeElement).toBe(items.at(-1));
    act(()=>document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
    expect(menuEl()).toBeNull();
    expect(document.activeElement).toBe(caret);
  });

  it("hangs the menu below the button, portalled clear of the clipping sheet", () => {
    const { root } = mount(true);
    click(root.querySelector('[aria-haspopup="menu"]')!);
    const menu = menuEl()!;
    // .bench-sheet sets overflow:hidden, so the menu renders on document.body
    // with fixed coordinates — inside the footer it would be invisible.
    expect(menu.parentElement).toBe(document.body);
    expect(root.contains(menu)).toBe(false);
    expect(menu.style.position).toBe("fixed");
    // jsdom reports a zero-height button, so this is the plain "below" anchor.
    expect(Number.parseInt(menu.style.top, 10)).toBeGreaterThan(0);
  });

  it("opens on hovering the caret but stays inert over the label", () => {
    const { root } = mount(true);
    const [label, caret] = buttons(root);
    // React fires mouseenter from a delegated mouseover whose relatedTarget is
    // outside the element.
    const hover = (el: Element) =>
      act(() => {
        el.dispatchEvent(
          new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body })
        );
      });

    hover(label);
    expect(menuEl()).toBeNull();

    hover(caret);
    expect(menuEl()).toBeTruthy();
  });

  it("shows the card in the page when the browser has no image clipboard", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.mocked(canCopyImages).mockReturnValue(false);
    const { root } = mount(true);
    click(root.querySelector('[aria-haspopup="menu"]')!);
    // Plain http on a LAN IP is not a secure context, so no page can write an
    // image to the clipboard there; the card goes on screen instead, where the
    // browser's own right-click Copy Image and drag-out work.
    expect(menuItems()).toEqual(["复制为文本", "显示卡片", "下载 PNG"]);

    const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
      (el) => (el.textContent || "").trim() === "显示卡片"
    )!;
    await act(async () => (item as HTMLButtonElement).click());
    expect(renderCardObjectUrl).toHaveBeenCalledTimes(1);
    expect(copyCardImage).not.toHaveBeenCalled();
    expect(byText(root, "已显示卡片")).toBeTruthy();

    const img = document.querySelector('[role="dialog"] img') as HTMLImageElement | null;
    expect(img?.getAttribute("src")).toBe("blob:card");
    expect(document.body.textContent).toContain("右键");

    // Close puts the blob URL out of its misery.
    const close = Array.from(document.querySelectorAll('[role="dialog"] button')).find(
      (b) => (b.textContent || "").trim() === "关闭"
    )!;
    await act(async () => (close as HTMLButtonElement).click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(root.querySelector('[aria-haspopup="menu"]'));
    expect(revoke).toHaveBeenCalledWith("blob:card");
    revoke.mockRestore();
  });

  it("still lets the card be downloaded where it cannot be copied", async () => {
    vi.mocked(canCopyImages).mockReturnValue(false);
    vi.mocked(copyCardImage).mockResolvedValueOnce("downloaded");
    const { root } = mount(true);
    click(root.querySelector('[aria-haspopup="menu"]')!);
    const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
      (el) => (el.textContent || "").trim() === "下载 PNG"
    )!;
    await act(async () => (item as HTMLButtonElement).click());
    expect(copyCardImage).toHaveBeenCalledWith(expect.anything(), expect.any(String), {
      writeClipboard: null,
    });
    expect(byText(root, "PNG 已保存")).toBeTruthy();
  });

  it("copies text from the menu as well", async () => {
    const { root } = mount(true);
    click(root.querySelector('[aria-haspopup="menu"]')!);
    const textItem = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
      (el) => (el.textContent || "").trim() === "复制为文本"
    )!;
    await act(async () => (textItem as HTMLButtonElement).click());
    expect(copyTextOnly).toHaveBeenCalledWith("summary text");
  });

  it("reports a download instead of a copy when the clipboard refuses the image", async () => {
    vi.mocked(copyCardImage).mockResolvedValueOnce("downloaded");
    const { root } = mount(true);
    click(root.querySelector('[aria-haspopup="menu"]')!);
    const imageItem = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
      (el) => (el.textContent || "").trim() === "复制为图片"
    )!;
    await act(async () => (imageItem as HTMLButtonElement).click());
    expect(byText(root, "PNG 已保存")).toBeTruthy();
  });

  it("surfaces a text-copy failure instead of claiming success", async () => {
    vi.mocked(copyTextOnly).mockRejectedValueOnce(new Error("denied"));
    const { root, onError } = mount(true);
    await act(async () => byText(root, "复制结果")!.click());
    expect(onError).toHaveBeenCalledWith("无法将结果复制到剪贴板");
    expect(byText(root, "复制结果")).toBeTruthy();
  });
});
