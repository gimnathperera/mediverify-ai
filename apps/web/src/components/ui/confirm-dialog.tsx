import * as AlertDialog from '@radix-ui/react-alert-dialog';
import type * as React from 'react';

import { cn } from '../../lib/utils';

import { Button } from './primitives';

/**
 * Themed confirmation for actions the user should not trigger by accident. Uses Radix AlertDialog:
 * announced as an alert dialog, focus starts on Cancel and is trapped, and Escape or a click on the
 * backdrop cancels. While `busy`, it can't be dismissed and the confirm button shows a spinner.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  icon,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  busy = false,
  destructive = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  icon: React.ReactNode;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  busy?: boolean;
  /** Red confirm button and icon, for actions that end or remove something. */
  destructive?: boolean;
}) {
  const close = (o: boolean) => !busy && onOpenChange(o);
  return (
    <AlertDialog.Root open={open} onOpenChange={close}>
      <AlertDialog.Portal>
        {/* AlertDialog ignores outside clicks by design; here a backdrop click cancels, like Cancel. */}
        <AlertDialog.Overlay
          data-testid="dialog-overlay"
          className="dialog-overlay fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-[2px]"
          onClick={() => close(false)}
        />
        <AlertDialog.Content
          className="dialog-content fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-slate-200 bg-white p-5 shadow-xl focus:outline-none"
          onEscapeKeyDown={(e) => busy && e.preventDefault()}
        >
          <div className="flex items-center gap-3">
            <span
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                destructive ? 'bg-rose-50 text-rose-600' : 'bg-brand-50 text-brand-700',
              )}
              aria-hidden
            >
              {icon}
            </span>
            <AlertDialog.Title className="text-base font-semibold text-slate-900">
              {title}
            </AlertDialog.Title>
          </div>
          <AlertDialog.Description className="mt-3 text-sm leading-relaxed text-slate-600">
            {description}
          </AlertDialog.Description>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel asChild>
              <Button variant="outline" disabled={busy}>
                {cancelLabel}
              </Button>
            </AlertDialog.Cancel>
            <Button
              variant={destructive ? 'destructive' : 'default'}
              onClick={onConfirm}
              loading={busy}
            >
              {confirmLabel}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
