import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'react-hot-toast';
import { afterEach, describe, expect, it } from 'vitest';

import { AppToaster } from '../src/components/ui/toaster';
import { notify } from '../src/lib/toast';

afterEach(() => {
  act(() => toast.remove());
});

function renderToaster() {
  render(<AppToaster />);
  return { user: userEvent.setup() };
}

describe('notify + AppToaster', () => {
  it('shows each kind with its own icon and the right live-region semantics', async () => {
    renderToaster();
    act(() => {
      notify.success('Upload accepted');
      notify.error('Upload failed');
      notify.warning('Daily limit almost reached');
      notify.info('Opening the existing job');
    });
    expect(await screen.findByText('Upload accepted')).toBeInTheDocument();
    // Success and info are polite status messages; errors and warnings are assertive alerts.
    expect(screen.getAllByRole('status').map((el) => el.textContent)).toEqual(
      expect.arrayContaining(['Upload accepted', 'Opening the existing job']),
    );
    expect(screen.getAllByRole('alert').map((el) => el.textContent)).toEqual(
      expect.arrayContaining(['Upload failed', 'Daily limit almost reached']),
    );
    // One distinct icon per kind (success/error icons come from react-hot-toast itself).
    expect(screen.getAllByTestId('toast-icon-warning')).toHaveLength(1);
    expect(screen.getAllByTestId('toast-icon-info')).toHaveLength(1);
  });

  it('puts a close button on each toast that dismisses it', async () => {
    const { user } = renderToaster();
    act(() => {
      notify.error('Upload failed');
    });
    const close = await screen.findByRole('button', {
      name: 'Dismiss notification: Upload failed',
    });
    await user.click(close);
    // react-hot-toast plays its exit animation, then removes the toast.
    await waitFor(() => expect(screen.queryByText('Upload failed')).not.toBeInTheDocument(), {
      timeout: 2000,
    });
  });

  it('shows no close button while loading, and resolves a promise toast', async () => {
    renderToaster();
    let resolve!: (v: string) => void;
    const work = new Promise<string>((r) => (resolve = r));
    act(() => {
      void notify.promise(work, {
        loading: 'Uploading…',
        success: 'Uploaded',
        error: 'Upload failed',
      });
    });
    expect(await screen.findByText('Uploading…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /dismiss notification/i })).not.toBeInTheDocument();
    await act(async () => {
      resolve('ok');
      await work;
    });
    expect(await screen.findByText('Uploaded')).toBeInTheDocument();
  });
});
