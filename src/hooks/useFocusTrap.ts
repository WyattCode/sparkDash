import { useEffect, useRef } from "react";

// Only the topmost dialog/menu owns Tab; portalled children are separate roots.
const traps: HTMLElement[] = [];

export function useFocusTrap<T extends HTMLElement = HTMLDivElement>(active: boolean, restoreFocus?: { current: HTMLElement | null }) {
  const ref = useRef<T | null>(null);
  const previous = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    previous.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = ref.current;
    if (!root) return;
    traps.push(root);
    const focusables = () => Array.from(root.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, summary, [tabindex]")).filter((el) => {
      if (el.tabIndex < 0 || el.matches(":disabled") || el.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
      if (getComputedStyle(el).visibility !== 'visible') return false;
      for (let node: HTMLElement | null = el; node; node = node.parentElement) {
        if (getComputedStyle(node).display === 'none') return false;
        if (node.tagName === 'DETAILS' && !node.hasAttribute('open')) {
          const summary = node.querySelector(':scope > summary');
          if (!summary?.contains(el)) return false;
        }
        if (node === root) break;
      }
      return true;
    });
    (focusables()[0] ?? root)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || event.defaultPrevented || traps.at(-1) !== root) return;
      const items = focusables();
      if (items.length === 0) { event.preventDefault(); root.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !items.includes(document.activeElement as HTMLElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !items.includes(document.activeElement as HTMLElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const wasTop = traps.at(-1) === root;
      const index = traps.indexOf(root);
      if (index >= 0) traps.splice(index, 1);
      const target = restoreFocus?.current ?? previous.current;
      if (wasTop && target?.isConnected && !target.matches(':disabled')) target.focus();
    };
  }, [active, restoreFocus]);

  return ref;
}
