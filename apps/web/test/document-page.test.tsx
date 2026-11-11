import type { JobEventDto } from '@mediverify/shared/client';
import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { DocumentPage } from '../src/pages/DocumentPage';

import { expectNoA11yViolations } from './a11y';
import { FakeEventSource } from './fake-event-source';
import { DOC_ID, failedJob, fx, JOB_ID, runningJob, server } from './msw';
import { renderWithProviders } from './render';

// pdf.js needs canvas and workers; the viewer is covered by Playwright. Here it is a stand-in that
// shows which page and quote the page asked it to display.
vi.mock('../src/components/PdfViewer', () => ({
  PdfViewer: ({ page, highlights }: { page: number; highlights: string[] }) => (
    <div data-testid="pdf-viewer">
      page {page} · {highlights.join(' | ')}
    </div>
  ),
}));

const open = (id = DOC_ID) =>
  renderWithProviders(<DocumentPage />, { route: `/documents/${id}`, path: '/documents/:id' });

function event(id: string, type: string, stage: string | null, payload = {}): JobEventDto {
  return {
    id,
    jobId: JOB_ID,
    stage,
    type,
    payload,
    createdAt: new Date().toISOString(),
  } as JobEventDto;
}

describe('DocumentPage', () => {
  it('shows results for a completed job and sets the tab title', async () => {
    open();
    expect(await screen.findByRole('heading', { name: 'Summary' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'primary_document_medical.pdf',
    );
    expect(screen.getByText(/pipeline completed — 8\/8 stages/i)).toBeInTheDocument();
    expect(document.title).toBe('primary_document_medical.pdf · MediVerify AI');
  });

  it('shows a citation from the results in the document viewer', async () => {
    const { user } = open();
    await screen.findByRole('heading', { name: 'Summary' });
    await user.click(screen.getByRole('tab', { name: /medications/i }));
    await user.click(screen.getByRole('button', { name: /show pravoxil prescription/i }));
    expect(await screen.findByTestId('pdf-viewer')).toHaveTextContent(/page 3 · Pravoxil/);
    expect(screen.getByRole('tab', { name: 'Document' })).toHaveAttribute('aria-selected', 'true');
  });

  it('says "not found" for a document the user cannot see (no existence leak)', async () => {
    open('someone-elses-document');
    expect(await screen.findByRole('alert')).toHaveTextContent(/document not found/i);
    expect(screen.getByRole('link', { name: /back to documents/i })).toHaveAttribute(
      'href',
      '/documents',
    );
  });

  it('explains a failed job in user terms and retries it', async () => {
    let retried = false;
    server.use(
      http.get('/api/jobs/:id', () =>
        HttpResponse.json(failedJob('MODEL_QUOTA_EXCEEDED', 'HTTP 429 insufficient_quota')),
      ),
      http.post('/api/jobs/:id/retry', () => {
        retried = true;
        return HttpResponse.json({ documentId: DOC_ID, jobId: JOB_ID, duplicate: false });
      }),
    );
    const { user } = open();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/processing failed/i);
    expect(alert).toHaveTextContent(/no remaining API credit/i);
    const timeline = screen.getByRole('list', { name: /pipeline stages/i });
    expect(within(timeline).getByText(/MODEL_QUOTA_EXCEEDED/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(retried).toBe(true));
  });

  it('follows live progress over SSE and loads results when the job ends', async () => {
    let job = runningJob('embedded', '100');
    server.use(http.get('/api/jobs/:id', () => HttpResponse.json(job)));
    open();
    const progress = await screen.findByRole('progressbar', { name: /stages completed/i });
    expect(progress).toHaveAttribute('aria-valuenow', '2');
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const es = FakeEventSource.instances[0]!;
    expect(es.url).toContain(`/api/jobs/${JOB_ID}/events?lastEventId=100`);

    act(() => es.open());
    expect(await screen.findByText('Live')).toBeInTheDocument();
    act(() => es.emit(event('101', 'stage.completed', 'embedded', { durationMs: 900 })));
    await waitFor(() => expect(progress).toHaveAttribute('aria-valuenow', '3'));
    // An event already reflected in the snapshot is ignored (replay after reconnect).
    act(() => es.emit(event('100', 'stage.completed', 'summarized')));
    act(() => es.emit(event('102', 'stage.started', 'summarized')));
    await waitFor(() =>
      expect(screen.getByText(/3 of 8 stages done/i)).toHaveTextContent(/summar/i),
    );
    expect(progress).toHaveAttribute('aria-valuenow', '3');

    job = fx.job();
    act(() => es.end());
    expect(await screen.findByRole('heading', { name: 'Summary' })).toBeInTheDocument();
    expect(es.readyState).toBe(FakeEventSource.CLOSED);
  });

  it('has no detectable accessibility violations once results are shown', async () => {
    const { container } = open();
    await screen.findByRole('heading', { name: 'Summary' });
    await expectNoA11yViolations(container);
  });

  it('deletes the document after confirmation and returns to the list', async () => {
    let deleted = false;
    server.use(
      http.delete('/api/documents/:id', () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { user } = open();
    await screen.findByRole('heading', { name: 'Summary' });
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete this document?' });
    expect(dialog).toHaveAccessibleDescription(/cannot be undone/);
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/documents$/));
    expect(deleted).toBe(true);
  });

  it('reconnects when the browser gives up on the live stream', async () => {
    server.use(http.get('/api/jobs/:id', () => HttpResponse.json(runningJob('embedded', '100'))));
    open();
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    act(() => FakeEventSource.instances[0]!.fail());
    expect(await screen.findByText(/live updates unavailable/i)).toBeInTheDocument();
    // A new stream is opened after a short backoff (no page refresh needed).
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(2), { timeout: 3000 });
  });

  it('shows what a failed job completed, labelled as partial', async () => {
    server.use(
      http.get('/api/jobs/:id', () =>
        HttpResponse.json(failedJob('MODEL_UNAVAILABLE', 'Model provider unavailable')),
      ),
    );
    open();
    expect(await screen.findByText('Partial results')).toBeInTheDocument();
    expect(screen.getByText(/processing stopped at summarized/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Summary' })).toBeInTheDocument();
  });

  it('on small screens, moves focus to the document and back to the quote link', async () => {
    const { user } = open();
    await screen.findByRole('heading', { name: 'Summary' });
    await user.click(screen.getByRole('tab', { name: /medications/i }));
    const link = screen.getByRole('button', { name: /show pravoxil prescription/i });
    await user.click(link);
    expect(screen.getByRole('tab', { name: 'Document' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(screen.getByRole('tabpanel', { name: 'Document' })).toHaveFocus());
    await user.click(screen.getByRole('button', { name: /back to results/i }));
    await waitFor(() => expect(link).toHaveFocus());
  });
});
