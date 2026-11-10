import { useLayoutEffect, useRef, useState } from 'react';

const ACTIVE = '[data-state="active"], [aria-pressed="true"]';

/**
 * A highlight that slides to the active item of a tab list or segmented control, instead of the
 * colour jumping from one item to the next. Put `listRef` on the (position: relative) container,
 * render `<TabIndicator ref={indicatorRef} />` as its first child, and pass the active value so the
 * indicator re-measures on change. Items must sit above it (`relative z-10`).
 *
 * The indicator is positioned by writing styles directly (no React state), so moving it never
 * re-renders the list; a ResizeObserver keeps it aligned when the layout changes.
 */
export function useTabIndicator<T extends HTMLElement>(active: unknown) {
  // A callback ref (state, not useRef) so the indicator is measured whenever the list mounts —
  // including lists that render only after their page finishes loading.
  const [list, listRef] = useState<T | null>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const indicator = indicatorRef.current;
    if (!list || !indicator) return;
    const place = () => {
      const item = list.querySelector<HTMLElement>(ACTIVE);
      if (!item) {
        indicator.style.opacity = '0';
        return;
      }
      indicator.style.opacity = '1';
      indicator.style.width = `${item.offsetWidth}px`;
      indicator.style.height = `${item.offsetHeight}px`;
      indicator.style.transform = `translate(${item.offsetLeft}px, ${item.offsetTop}px)`;
    };
    place();
    // Animate only moves, not the first placement (otherwise it slides in from the corner).
    const frame = requestAnimationFrame(() => indicator.classList.add('tab-indicator--ready'));
    const ro = new ResizeObserver(place);
    ro.observe(list);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [list, active]);

  return { listRef, indicatorRef };
}

export function TabIndicator({ ref }: { ref: React.Ref<HTMLSpanElement> }) {
  return (
    <span
      ref={ref}
      aria-hidden
      data-testid="tab-indicator"
      className="tab-indicator pointer-events-none absolute left-0 top-0 rounded-md bg-brand-700 opacity-0 shadow-sm"
    />
  );
}

/** Classes for an item inside an indicator list: text colour changes, the background slides. */
export const TAB_ITEM =
  'relative z-10 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors duration-200 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-brand-600 data-[state=active]:text-white aria-pressed:text-white';
