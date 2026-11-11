import { useEffect, useRef, useState } from 'react';

/** `value`, updated only after it has been stable for `ms` (e.g. a search box → server query). */
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/**
 * Call `onVisible` whenever the returned element scrolls into view (infinite lists). Keeps the
 * latest callback without re-creating the observer.
 */
export function useOnVisible<T extends Element>(onVisible: () => void, enabled: boolean) {
  const ref = useRef<T>(null);
  const cb = useRef(onVisible);
  useEffect(() => {
    cb.current = onVisible;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) cb.current();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [enabled]);
  return ref;
}
