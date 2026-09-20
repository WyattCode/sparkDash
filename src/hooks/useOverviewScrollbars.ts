import { useEffect } from 'react';

/** Preserve scroll geometry; only reveal the thumb of the surface being scrolled. */
export function useOverviewScrollbars(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    const timers = new Map<HTMLElement, number>();
    root.classList.add('overview-scrollbars');
    const onScroll = (event: Event) => {
      const target = event.target === document ? root : event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target !== root && !target.matches('.app-frame main *, .pill-nav, .mobile-spark-menu')) return;
      window.clearTimeout(timers.get(target));
      target.setAttribute('data-scrolling', 'true');
      timers.set(target, window.setTimeout(() => {
        target.removeAttribute('data-scrolling');
        timers.delete(target);
      }, 900));
    };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener('scroll', onScroll, true);
      root.classList.remove('overview-scrollbars');
      for (const [target, timer] of timers) {
        window.clearTimeout(timer);
        target.removeAttribute('data-scrolling');
      }
    };
  }, [enabled]);
}
