import { Eye, EyeOff } from 'lucide-react';
import * as React from 'react';

import { cn } from '../../lib/utils';

import { Button, Input } from './primitives';

/**
 * Password field with a show/hide toggle inside it. Toggling keeps focus and the caret/selection
 * in the field (the button never takes focus on mouse down, and the selection is restored after
 * the input type changes).
 */
export const PasswordInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>
>(({ className, ...props }, forwardedRef) => {
  const [visible, setVisible] = React.useState(false);
  const inner = React.useRef<HTMLInputElement>(null);
  const selection = React.useRef<[number | null, number | null] | null>(null);
  React.useImperativeHandle(forwardedRef, () => inner.current!, []);

  const toggle = () => {
    const el = inner.current;
    // Remember the caret only if the user was typing in the field (keyboard toggles move focus).
    selection.current =
      el && document.activeElement === el ? [el.selectionStart, el.selectionEnd] : null;
    setVisible((v) => !v);
  };

  // Changing `type` can reset the caret in some browsers; put it back where it was.
  React.useLayoutEffect(() => {
    const el = inner.current;
    const sel = selection.current;
    if (!el || !sel) return;
    selection.current = null;
    el.focus();
    el.setSelectionRange(sel[0], sel[1]);
  }, [visible]);

  return (
    <div className="relative">
      <Input
        ref={inner}
        type={visible ? 'text' : 'password'}
        className={cn('pr-10', className)}
        {...props}
      />
      {/* Same placement and look as the search field's clear button. */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={toggle}
        // Keep focus (and the caret) in the field when the toggle is clicked with a mouse.
        onMouseDown={(e) => e.preventDefault()}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        disabled={props.disabled}
        className="absolute right-1.5 top-1/2 h-7 w-7 -translate-y-1/2 text-slate-500 hover:text-slate-900"
      >
        {visible ? (
          <EyeOff className="h-4 w-4" aria-hidden />
        ) : (
          <Eye className="h-4 w-4" aria-hidden />
        )}
      </Button>
    </div>
  );
});
PasswordInput.displayName = 'PasswordInput';
