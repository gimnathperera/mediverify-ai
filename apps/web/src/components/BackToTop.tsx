import { ArrowUp } from 'lucide-react';
import { useEffect, useState } from 'react';

import { cn, scrollBehavior } from '../lib/utils';

/** Show the button once the page has scrolled this far (about one screen). */
const SHOW_AFTER_PX = 600;

/**
 * Floating "back to top" button for long pages. Appears after the page has scrolled, scrolls
 * smoothly to the top (instantly with reduced motion) and moves focus to the main content so
 * keyboard users continue from the top too.
 */
export function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      setVisible(window.scrollY > SHOW_AFTER_PX);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <button
      type="button"
      aria-label="Back to top"
      title="Back to top"
      // Hidden (and out of the tab order) until the page has scrolled.
      tabIndex={visible ? 0 : -1}
      aria-hidden={!visible || undefined}
      onClick={() => {
        window.scrollTo({ top: 0, behavior: scrollBehavior() });
        document.getElementById('main')?.focus({ preventScroll: true });
      }}
      className={cn(
        'fixed bottom-4 right-4 z-30 inline-flex h-11 w-11 items-center justify-center rounded-full bg-brand-700 text-white shadow-lg ring-1 ring-black/5 transition-all duration-200 hover:bg-brand-800 hover:shadow-xl motion-reduce:transition-none sm:bottom-6 sm:right-6',
        visible
          ? 'translate-y-0 scale-100 opacity-100'
          : 'pointer-events-none translate-y-2 scale-90 opacity-0',
      )}
    >
      <ArrowUp className="h-5 w-5" aria-hidden />
    </button>
  );
}
