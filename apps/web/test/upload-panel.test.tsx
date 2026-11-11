import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { UploadPanel } from '../src/components/UploadPanel';

import { expectNoA11yViolations } from './a11y';
import { fx } from './msw';
import { renderWithProviders } from './render';

const pdf = (name = 'discharge.pdf') =>
  new File([new TextEncoder().encode('%PDF-1.7\n%test\n')], name, { type: 'application/pdf' });

function setup(props: Partial<React.ComponentProps<typeof UploadPanel>> = {}) {
  const onSubmit = vi.fn();
  const utils = renderWithProviders(
    <UploadPanel
      references={fx.references()}
      referencesLoading={false}
      onSubmit={onSubmit}
      busy={false}
      {...props}
    />,
  );
  return { ...utils, onSubmit };
}

describe('UploadPanel', () => {
  it('submits a valid PDF with the selected reference', async () => {
    const { user, onSubmit } = setup();
    await user.upload(screen.getByLabelText(/choose a pdf or docx file/i), pdf());
    expect(onSubmit).toHaveBeenCalledWith(expect.any(File), fx.references()[0]!.id);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('rejects a dropped file of an unsupported type', async () => {
    const { onSubmit } = setup();
    // The drop event bubbles from the prompt text to the drop zone.
    fireEvent.drop(screen.getByText(/drag & drop a/i), {
      dataTransfer: { files: [new File(['hello'], 'notes.txt', { type: 'text/plain' })] },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(/only pdf .* and word .* files/i);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('rejects a file whose content is not really a PDF', async () => {
    const { user, onSubmit } = setup();
    await user.upload(
      screen.getByLabelText(/choose a pdf or docx file/i),
      new File(['not a pdf'], 'fake.pdf', { type: 'application/pdf' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(/does not look like a valid pdf/i);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows the reference index status and disables upload without references', () => {
    setup();
    expect(screen.getByText(/indexed: 8 monographs/i)).toBeInTheDocument();
    setup({ references: [] });
    expect(screen.getAllByRole('button', { name: /choose file/i }).at(-1)).toBeDisabled();
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = setup();
    await expectNoA11yViolations(container);
  });
});
