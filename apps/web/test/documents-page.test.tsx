import type { DocumentDto } from '@mediverify/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { DocumentsPage, filterDocuments } from '../src/pages/DocumentsPage';

import { expectNoA11yViolations } from './a11y';
import { apiError, fx, server } from './msw';
import { renderWithProviders } from './render';

function doc(filename: string, status: 'completed' | 'failed' | 'running'): DocumentDto {
  const d = fx.document();
  return {
    ...d,
    id: `${filename}-${status}`,
    filename,
    latestJob: {
      ...d.latestJob!,
      status,
      currentStage: status === 'running' ? 'embedded' : d.latestJob!.currentStage,
      errorMessage: status === 'failed' ? 'Model provider account has no remaining credit' : null,
    },
  };
}

const LIST = [
  doc('discharge-a.pdf', 'completed'),
  doc('discharge-b.pdf', 'failed'),
  doc('summary-c.docx', 'running'),
];

const pdf = () =>
  new File([new TextEncoder().encode('%PDF-1.7\n%test\n')], 'new-upload.pdf', {
    type: 'application/pdf',
  });

describe('filterDocuments', () => {
  it('matches file name case-insensitively and groups queued/running as processing', () => {
    expect(filterDocuments(LIST, 'DISCHARGE', 'all').map((d) => d.filename)).toEqual([
      'discharge-a.pdf',
      'discharge-b.pdf',
    ]);
    expect(filterDocuments(LIST, '', 'processing').map((d) => d.filename)).toEqual([
      'summary-c.docx',
    ]);
    expect(filterDocuments(LIST, 'nothing', 'all')).toEqual([]);
  });
});

describe('DocumentsPage', () => {
  it('lists documents with status, stage and failure reason', async () => {
    server.use(http.get('/api/documents', () => HttpResponse.json(LIST)));
    renderWithProviders(<DocumentsPage />);
    const list = screen.getByRole('list', { name: 'Documents' });
    const rows = await within(list).findAllByRole('link');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent(/failed/i);
    expect(rows[1]).toHaveTextContent(/no remaining credit/i);
    expect(rows[2]).toHaveTextContent(/processing/i);
    expect(document.title).toBe('Documents · MediVerify AI');
  });

  it('filters by search text and status, and offers to clear an empty result', async () => {
    server.use(http.get('/api/documents', () => HttpResponse.json(LIST)));
    const { user } = renderWithProviders(<DocumentsPage />);
    const list = screen.getByRole('list', { name: 'Documents' });
    await within(list).findAllByRole('link');

    await user.click(screen.getByRole('button', { name: /failed 1/i }));
    expect(within(list).getAllByRole('link')).toHaveLength(1);

    await user.type(screen.getByRole('searchbox', { name: /search documents/i }), 'zzz');
    expect(within(list).queryAllByRole('link')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: /clear search and filters/i }));
    expect(within(list).getAllByRole('link')).toHaveLength(3);
  });

  it('shows an empty state for a new user', async () => {
    server.use(http.get('/api/documents', () => HttpResponse.json([])));
    renderWithProviders(<DocumentsPage />);
    expect(await screen.findByText('No documents yet')).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('shows a retryable error when the list cannot load', async () => {
    let fail = true;
    server.use(
      http.get('/api/documents', () =>
        fail ? apiError(500, 'INTERNAL', 'Database unavailable') : HttpResponse.json(LIST),
      ),
    );
    const { user } = renderWithProviders(<DocumentsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/database unavailable/i);
    fail = false;
    await user.click(screen.getByRole('button', { name: /^retry$/i }));
    expect(await screen.findAllByRole('link')).toHaveLength(3);
  });

  it('uploads a file and opens the new document', async () => {
    server.use(
      http.post('/api/documents', () =>
        HttpResponse.json(
          { documentId: 'new-doc', jobId: 'new-job', duplicate: false },
          { status: 202 },
        ),
      ),
    );
    const { user } = renderWithProviders(<DocumentsPage />);
    await screen.findByText(/indexed: 8 monographs/i);
    await user.upload(screen.getByLabelText(/choose a pdf or docx file/i), pdf());
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/documents/new-doc'),
    );
  });

  it('keeps a rejected upload visible with the server reason until dismissed', async () => {
    server.use(
      http.post('/api/documents', () =>
        apiError(429, 'QUOTA_EXCEEDED', 'Daily job limit reached (20 per 24 hours)'),
      ),
    );
    const { user } = renderWithProviders(<DocumentsPage />);
    await screen.findByText(/indexed: 8 monographs/i);
    await user.upload(screen.getByLabelText(/choose a pdf or docx file/i), pdf());
    expect(await screen.findByText(/upload rejected/i)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/daily job limit reached/i);
    await user.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByText(/upload rejected/i)).not.toBeInTheDocument();
  });

  it('has no detectable accessibility violations', async () => {
    server.use(http.get('/api/documents', () => HttpResponse.json(LIST)));
    const { container } = renderWithProviders(<DocumentsPage />);
    await screen.findByText('discharge-a.pdf');
    await expectNoA11yViolations(container);
  });
});
