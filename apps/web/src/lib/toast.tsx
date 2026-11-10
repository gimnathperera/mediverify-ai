import { toast, type ToastOptions } from 'react-hot-toast';

import { InfoIcon, WarningIcon } from '../components/ui/toaster';

type Message = Parameters<typeof toast>[0];

/** Errors interrupt screen readers; everything else is announced politely (react-hot-toast default). */
const ALERT = { ariaProps: { role: 'alert', 'aria-live': 'assertive' } } as const;

/**
 * The app's notification API. Four distinct kinds, each with its own icon and colour:
 * success (green check, 2 s), error (red cross, 4 s), warning (amber "!", 4 s), info (blue "i", 4 s).
 */
export const notify = {
  success: (message: Message, opts?: ToastOptions) => toast.success(message, opts),
  error: (message: Message, opts?: ToastOptions) => toast.error(message, { ...ALERT, ...opts }),
  warning: (message: Message, opts?: ToastOptions) =>
    toast(message, { icon: <WarningIcon />, ...ALERT, ...opts }),
  info: (message: Message, opts?: ToastOptions) => toast(message, { icon: <InfoIcon />, ...opts }),
  loading: (message: Message, opts?: ToastOptions) => toast.loading(message, opts),
  promise: <T,>(...args: Parameters<typeof toast.promise<T>>) => toast.promise<T>(...args),
  dismiss: (id?: string) => toast.dismiss(id),
};
