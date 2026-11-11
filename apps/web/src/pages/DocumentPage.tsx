import { isTerminalJobStatus, STAGE_LABELS } from '@mediverify/shared/client';
import * as Tabs from '@radix-ui/react-tabs';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FileText, RotateCcw, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { PdfViewer } from '../components/LazyPdfViewer';
import { PipelineTimeline } from '../components/PipelineTimeline';
import { ResultsView } from '../components/results/ResultsView';
import { DocumentPageSkeleton, ResultsSkeleton } from '../components/skeletons';
import { JobStatusBadge } from '../components/status';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import { Alert, Button, Card, Skeleton, Spinner } from '../components/ui/primitives';
import { TAB_ITEM, TabIndicator, useTabIndicator } from '../components/ui/tab-indicator';
import { ApiRequestError } from '../lib/api';
import { jobFailureMessage } from '../lib/messages';
import {
  qk,
  useDeleteDocument,
  useDocument,
  useJob,
  useResults,
  useRetryJob,
} from '../lib/queries';
import { notify } from '../lib/toast';
import { useJobStream } from '../lib/useJobStream';
import { usePageTitle } from '../lib/usePageTitle';
import { formatDuration, formatUsage } from '../lib/utils';

type Pane = 'results' | 'document';

const PANE_TAB = `${TAB_ITEM} flex-1`;

export function DocumentPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const doc = useDocument(id);
  const jobId = doc.data?.latestJob?.id;
  const job = useJob(jobId);
  const { state, notes } = useJobStream(job.data);
  const done = job.data?.status === 'completed';
  const failed = job.data?.status === 'failed';
  const results = useResults(jobId, Boolean(job.data && isTerminalJobStatus(job.data.status)));
  const retry = useRetryJob();
  const remove = useDeleteDocument();
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const documentPane = useRef<HTMLDivElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const [page, setPage] = useState(1);
  const [highlights, setHighlights] = useState<string[]>([]);
  const [pane, setPane] = useState<Pane>('results');
  const { listRef: paneList, indicatorRef: paneIndicator } = useTabIndicator<HTMLDivElement>(pane);
  usePageTitle(doc.data?.filename ?? (doc.isError ? 'Document not found' : 'Document'));

  if (doc.isLoading) return <DocumentPageSkeleton />;
  if (doc.isError) {
    const notFound = doc.error instanceof ApiRequestError && doc.error.status === 404;
    return (
      <Alert
        tone="danger"
        title={notFound ? 'Document not found' : 'Could not load document'}
        action={
          <Button variant="outline" size="sm" asChild>
            <Link to="/documents">Back to documents</Link>
          </Button>
        }
      >
        {notFound ? 'It does not exist or you do not have access to it.' : doc.error.message}
      </Alert>
    );
  }
  const d = doc.data!;
  const totalMs = job.data?.stages.reduce((n, s) => n + (s.durationMs ?? 0), 0) ?? 0;
  const canPreview =
    d.mimeType === 'application/pdf' ||
    job.data?.stages.find((s) => s.stage === 'parsed')?.status === 'completed';

  // A failed job keeps what it completed (e.g. summary and extraction before verification failed).
  const r = results.data;
  const partial =
    failed &&
    r &&
    Boolean(r.summary || r.criticalPoints.length || r.medications.length || r.verifications.length);
  const showResults = (done || partial) && r;

  /** Show a quote in the PDF. On small screens that switches panes: move focus with it. */
  const showQuote = (p: number | null, quote: string) => {
    if (p) setPage(p);
    setHighlights([quote]);
    setPane('document');
    if (window.matchMedia?.('(min-width: 1024px)').matches) return; // side by side: focus stays
    returnFocusTo.current = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => {
      const pane = documentPane.current;
      (pane?.querySelector<HTMLElement>('[role="region"][tabindex="0"]') ?? pane)?.focus();
    });
  };
  const backToResults = () => {
    setPane('results');
    requestAnimationFrame(() => {
      if (returnFocusTo.current?.isConnected) returnFocusTo.current.focus();
    });
  };

  const onRetry = () => {
    if (!jobId) return;
    retry.mutate(jobId, {
      onSuccess: (r) => {
        notify.success('Retry queued');
        // Point the page at the new job at once, so Retry can't be clicked twice for the old one.
        qc.setQueryData(qk.document(id), {
          ...d,
          latestJob: {
            id: r.jobId,
            status: 'queued' as const,
            currentStage: null,
            errorMessage: null,
          },
        });
        void qc.invalidateQueries({ queryKey: qk.document(id) });
      },
      onError: (e) => notify.error(e.message),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/documents" aria-label="Back to documents">
              <ArrowLeft className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
          <FileText className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
          <div className="min-w-0">
            <h1 className="truncate font-semibold text-slate-900">{d.filename}</h1>
            <p className="text-xs text-slate-600">
              Verified against {d.reference.title} — rev. {d.reference.versionLabel}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {job.data && <JobStatusBadge status={job.data.status} />}
          {failed && (
            <Button size="sm" variant="outline" onClick={onRetry} loading={retry.isPending}>
              <RotateCcw className="h-4 w-4" aria-hidden />
              Retry
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="h-4 w-4" aria-hidden />
            Delete
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        icon={<Trash2 className="h-4 w-4" />}
        title="Delete this document?"
        description={`"${d.filename}", its processing history and all verification results will be permanently deleted. This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        busy={remove.isPending}
        onConfirm={() =>
          remove.mutate(id, {
            onSuccess: () => {
              notify.success('Document deleted');
              void navigate('/documents');
            },
            onError: (e) => {
              setConfirmDelete(false);
              notify.error(e.message);
            },
          })
        }
      />

      {job.isLoading && <Skeleton className="h-10 w-full rounded-xl" />}
      {job.isError && (
        <Alert tone="danger" title="Could not load job status">
          {job.error.message}
        </Alert>
      )}
      {!jobId && <Alert tone="warning" title="No processing job found for this document" />}

      {job.data && !done && <PipelineTimeline job={job.data} stream={state} notes={notes} />}
      {failed && (
        <Alert tone="danger" title="Processing failed">
          {jobFailureMessage(job.data!.errorCode, job.data!.errorMessage)}
        </Alert>
      )}
      {done && job.data && (
        <details className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm">
          <summary className="cursor-pointer select-none text-slate-700">
            Pipeline completed — {job.data.stages.length}/{job.data.stages.length} stages in{' '}
            {formatDuration(totalMs)}
            {formatUsage(job.data.llmUsage, job.data.llmProvider)}
          </summary>
          <div className="py-3">
            <PipelineTimeline job={job.data} stream={state} notes={notes} compact />
          </div>
        </details>
      )}

      {/* One layout: side by side on large screens, tabs on small screens (same DOM, so the PDF
          viewer keeps its page when switching). */}
      <Tabs.Root value={pane} onValueChange={(v) => setPane(v as Pane)}>
        <Tabs.List
          ref={paneList}
          className="relative mb-4 flex gap-1 rounded-lg border border-slate-200 bg-white p-1 lg:hidden"
          aria-label="View"
        >
          <TabIndicator ref={paneIndicator} />
          <Tabs.Trigger value="results" className={PANE_TAB}>
            Results
          </Tabs.Trigger>
          <Tabs.Trigger value="document" className={PANE_TAB}>
            Document
          </Tabs.Trigger>
        </Tabs.List>
        <div className="grid gap-4 lg:grid-cols-2">
          <Tabs.Content
            ref={documentPane}
            value="document"
            forceMount
            className="data-[state=inactive]:hidden lg:data-[state=inactive]:block"
          >
            <Button variant="ghost" size="sm" className="mb-2 lg:hidden" onClick={backToResults}>
              <ArrowLeft className="h-4 w-4" aria-hidden /> Back to results
            </Button>
            <Card className="h-[75vh] overflow-hidden lg:sticky lg:top-20">
              {canPreview ? (
                <PdfViewer
                  url={`/api/documents/${d.id}/file`}
                  page={page}
                  onPageChange={setPage}
                  highlights={highlights}
                  title={d.filename}
                  onClearHighlights={() => setHighlights([])}
                />
              ) : (
                <div className="flex h-full items-center justify-center p-6 text-center text-sm text-slate-600">
                  Preview will be available once the DOCX has been converted (parsed stage).
                </div>
              )}
            </Card>
          </Tabs.Content>
          <Tabs.Content
            value="results"
            forceMount
            className="min-w-0 data-[state=inactive]:hidden lg:data-[state=inactive]:block"
          >
            {done && results.isLoading && <ResultsSkeleton />}
            {results.isError && (
              <Alert tone="danger" title="Could not load results">
                {results.error.message}
              </Alert>
            )}
            {partial && (
              <Alert tone="warning" title="Partial results" className="mb-4">
                Processing stopped at{' '}
                {job.data?.currentStage ? STAGE_LABELS[job.data.currentStage] : 'a stage'}. What was
                completed before the failure is shown below; later sections are empty. Retry to
                finish.
              </Alert>
            )}
            {showResults && <ResultsView results={r} onShowPrimaryQuote={showQuote} />}
            {!done && !failed && (
              <Card className="p-6 text-sm text-slate-600">
                <Spinner label="Results will appear here when verification completes." />
                <p className="mt-2 text-xs">
                  You can leave or refresh this page — progress is tracked on the server.
                </p>
              </Card>
            )}
          </Tabs.Content>
        </div>
      </Tabs.Root>
    </div>
  );
}
