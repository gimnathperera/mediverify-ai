import { screen, waitFor, within } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { RequireAuth } from '../src/App';
import { AppShell } from '../src/components/AppShell';
import { UploadPanel } from '../src/components/UploadPanel';
import { DocumentPage } from '../src/pages/DocumentPage';
import { DocumentsPage } from '../src/pages/DocumentsPage';

import { expectNoA11yViolations } from './a11y';
import { DOC_ID, fx, server } from './msw';
import { renderWithProviders } from './render';

vi.mock('../src/components/PdfViewer', () => ({
  PdfViewer: () => <div data-testid="pdf-viewer" />,
}));

const never = () => delay('infinite');

describe('loading skeletons', () => {
  it('shows the page skeleton inside the app frame while the session is checked', async () => {
    server.use(http.get('/api/auth/me', never));
    renderWithProviders(
      <Routes>
        <Route
          path="/documents"
          element={
            <RequireAuth skeleton={<p>documents skeleton</p>}>
              <p>secret documents</p>
            </RequireAuth>
          }
        />
      </Routes>,
      { route: '/documents' },
    );
    expect(await screen.findByText('documents skeleton')).toBeInTheDocument();
    expect(screen.getByText('MediVerify')).toBeInTheDocument(); // header frame, no full-page spinner
    expect(screen.queryByText('secret documents')).not.toBeInTheDocument();
  });

  it('shows section skeletons for the document list and the reference selector', () => {
    server.use(http.get('/api/documents', never), http.get('/api/references', never));
    renderWithProviders(<DocumentsPage />);
    expect(screen.getByRole('status', { name: 'Loading your documents' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading reference documents' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('shows the document page skeleton, then places the tab highlight once tabs mount', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    server.use(
      http.get('/api/documents/:id', async ({ params }) => {
        await gate;
        return HttpResponse.json({ ...fx.document(), id: params.id });
      }),
    );
    renderWithProviders(<DocumentPage />, {
      route: `/documents/${DOC_ID}`,
      path: '/documents/:id',
    });
    expect(screen.getByRole('status', { name: 'Loading document' })).toBeInTheDocument();
    release();
    await screen.findByRole('heading', { name: 'Summary' });
    // Both tab lists (Results/Document and the result sections) mounted after loading; their
    // sliding highlight must be measured, or the active tab's white text would sit on white.
    const indicators = screen.getAllByTestId('tab-indicator');
    expect(indicators).toHaveLength(2);
    for (const el of indicators) expect(el).toHaveStyle({ opacity: '1' });
  });

  it('replaces the reference selector with a skeleton only while loading', () => {
    const { rerender } = renderWithProviders(
      <UploadPanel references={undefined} referencesLoading onSubmit={vi.fn()} busy={false} />,
    );
    expect(screen.getByRole('status', { name: 'Loading reference documents' })).toBeInTheDocument();
    rerender(
      <UploadPanel
        references={fx.references()}
        referencesLoading={false}
        onSubmit={vi.fn()}
        busy={false}
      />,
    );
    expect(
      screen.queryByRole('status', { name: 'Loading reference documents' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Reference document' })).toHaveValue(
      fx.references()[0]!.id,
    );
  });
});

describe('sign out', () => {
  const shell = (
    <Routes>
      <Route path="/login" element={<p>login page</p>} />
      <Route
        path="/documents"
        element={
          <AppShell>
            <p>page</p>
          </AppShell>
        }
      />
    </Routes>
  );

  it('asks for confirmation; Cancel keeps the session', async () => {
    let calls = 0;
    server.use(
      http.post('/api/auth/logout', () => {
        calls++;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { user } = renderWithProviders(shell, { route: '/documents' });
    await user.click(await screen.findByRole('button', { name: /sign out/i }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Sign out of MediVerify?' });
    expect(dialog).toHaveAccessibleDescription(/documents and results stay saved/);
    expect(within(dialog).queryByText(/signed in as/i)).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await expectNoA11yViolations(document.body);

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(calls).toBe(0);
    expect(screen.getByTestId('location')).toHaveTextContent('/documents');
  });

  it('clicking outside the dialog cancels, like Cancel', async () => {
    let calls = 0;
    server.use(
      http.post('/api/auth/logout', () => {
        calls++;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { user } = renderWithProviders(shell, { route: '/documents' });
    await user.click(await screen.findByRole('button', { name: /sign out/i }));
    await screen.findByRole('alertdialog');
    await user.click(screen.getByTestId('dialog-overlay'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(calls).toBe(0);
    expect(screen.getByTestId('location')).toHaveTextContent('/documents');
  });

  it('Escape also cancels', async () => {
    const { user } = renderWithProviders(shell, { route: '/documents' });
    await user.click(await screen.findByRole('button', { name: /sign out/i }));
    await screen.findByRole('alertdialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('confirming signs out and returns to the sign-in page', async () => {
    let calls = 0;
    server.use(
      http.post('/api/auth/logout', () => {
        calls++;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { user } = renderWithProviders(shell, { route: '/documents' });
    await user.click(await screen.findByRole('button', { name: /sign out/i }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('login page')).toBeInTheDocument();
    expect(calls).toBe(1);
  });
});
