import { X } from 'lucide-react';
import { resolveValue, toast, ToastBar, Toaster, type Toast } from 'react-hot-toast';

function dismissLabel(t: Toast) {
  const msg = resolveValue(t.message, t);
  return typeof msg === 'string' ? `Dismiss notification: ${msg}` : 'Dismiss notification';
}

/**
 * App-wide toasts: react-hot-toast unchanged (top-center, slide/scale-in, pause on hover, stacking,
 * animated success/error/loading icons, default durations), plus:
 *  - warning and info icons drawn in the same animated-circle style (see styles.css `.toast-icon`);
 *  - a close button in the top-right corner of every toast (except while loading).
 * Use `notify` from lib/toast.tsx rather than calling react-hot-toast directly.
 */
export function AppToaster() {
  return (
    <Toaster
      position="top-center"
      gutter={8}
      toastOptions={{ className: 'app-toast', style: { maxWidth: 380 } }}
    >
      {(t: Toast) => (
        <ToastBar toast={t} style={{ ...t.style, position: 'relative', paddingRight: 32 }}>
          {({ icon, message }) => (
            <>
              {icon}
              {message}
              {t.type !== 'loading' && (
                <button
                  type="button"
                  onClick={() => toast.dismiss(t.id)}
                  aria-label={dismissLabel(t)}
                  className="absolute right-1.5 top-1.5 inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-brand-600"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              )}
            </>
          )}
        </ToastBar>
      )}
    </Toaster>
  );
}

/** Amber circle with "!" — same size, colours and entrance timing as react-hot-toast's icons. */
export function WarningIcon() {
  return (
    <span className="toast-icon toast-icon--warning" data-testid="toast-icon-warning" aria-hidden />
  );
}

/** Blue circle with "i". */
export function InfoIcon() {
  return <span className="toast-icon toast-icon--info" data-testid="toast-icon-info" aria-hidden />;
}
