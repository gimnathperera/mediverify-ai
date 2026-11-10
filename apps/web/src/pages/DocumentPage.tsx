import { isTerminalJobStatus } from '@mediverify/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FileText, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';

import { PdfViewer } from '../components/LazyPdfViewer';
import { PipelineTimeline } from '../components/PipelineTimeline';
import { ResultsView } from '../components/Results';
import { JobStatusBadge } from '../components/status';
import { Alert, Button, Card, Skeleton, Spinner } from '../components/ui/primitives';
import { ApiRequestError } from '../lib/api';
import { qk, useDocument, useJob, useResults, useRetryJob } from '../lib/queries';
import { useJobStream } from '../lib/useJobStream';
import { cn, formatDuration } from '../lib/utils';

export function DocumentPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const doc = useDocument(id);
  const jobId = doc.data?.latestJob?.id;
  const job = useJob(jobId);
  const { state, notes } = useJobStream(job.data);
  const done = job.data?.status === 'completed';
  const results = useResults(jobId, Boolean(job.data && isTerminalJobStatus(job.data.status)));
  const retry = useRetryJob();
  const [page, setPage] = useState(1);
  const [highlights, setHighlights] = useState<string[]>([]);
  const [mobileTab, setMobileTab] = useState<'results' | 'document'>('results');

  if (doc.isLoading)
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
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

  const onRetry = () => {
    if (!jobId) return;
    retry.mutate(jobId, {
      onSuccess: () => {
        toast.success('Retry queued');
        void qc.invalidateQueries({ queryKey: qk.document(id) });
      },
      onError: (e) => toast.error(e.message),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void navigate('/documents')}
            aria-label="Back to documents"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <FileText className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
          <div className="min-w-0">
            <h1 className="truncate font-semibold text-slate-900">{d.filename}</h1>
            <p className="text-xs text-slate-500">
              Verified against {d.reference.title} — rev. {d.reference.versionLabel}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {job.data && <JobStatusBadge status={job.data.status} />}
          {job.data?.status === 'failed' && (
            <Button size="sm" variant="outline" onClick={onRetry} loading={retry.isPending}>
              <RotateCcw className="h-4 w-4" aria-hidden />
              Retry
            </Button>
          )}
        </div>
      </div>

      {job.isLoading && <Spinner label="Loading job status…" />}
      {job.isError && (
        <Alert tone="danger" title="Could not load job status">
          {job.error.message}
        </Alert>
      )}
      {!jobId && <Alert tone="warning" title="No processing job found for this document" />}

      {job.data && !done && <PipelineTimeline job={job.data} stream={state} notes={notes} />}
      {job.data?.status === 'failed' && (
        <Alert
          tone="danger"
          title="Processing failed"
          action={
            <Button size="sm" onClick={onRetry} loading={retry.isPending}>
              Retry
            </Button>
          }
        >
          {job.data.errorCode === 'MODEL_QUOTA_EXCEEDED'
            ? 'The OpenAI account behind this deployment has no remaining API credit. Add credit in the OpenAI billing settings, then retry; parsing results are kept.'
            : job.data.errorCode === 'MODEL_NOT_CONFIGURED' ||
                job.data.errorCode === 'MODEL_UNAVAILABLE'
              ? `The language model is unavailable (${job.data.errorMessage}). Parsing results are kept; retry once the model is configured.`
              : job.data.errorMessage}
        </Alert>
      )}
      {done && job.data && (
        <details className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm">
          <summary className="cursor-pointer select-none text-slate-600">
            Pipeline completed — 8/8 stages in {formatDuration(totalMs)}
            {job.data.llmProvider ? ` · LLM: ${job.data.llmProvider}` : ''}
          </summary>
          <div className="py-3">
            <PipelineTimeline job={job.data} stream={state} notes={notes} compact />
          </div>
        </details>
      )}

      <div
        className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1 lg:hidden"
        role="tablist"
        aria-label="View"
      >
        {(['results', 'document'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={mobileTab === t}
            onClick={() => setMobileTab(t)}
            className={cn(
              'flex-1 rounded-md px-3 py-1.5 text-sm capitalize',
              mobileTab === t ? 'bg-brand-700 text-white' : 'text-slate-600',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          className={cn(
            'h-[75vh] overflow-hidden lg:sticky lg:top-20 lg:block',
            mobileTab === 'document' ? 'block' : 'hidden',
          )}
        >
          {canPreview ? (
            <PdfViewer
              url={`/api/documents/${d.id}/file`}
              page={page}
              onPageChange={setPage}
              highlights={highlights}
              title={d.filename}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-slate-500">
              Preview will be available once the DOCX has been converted (parsed stage).
            </div>
          )}
        </Card>
        <div className={cn('min-w-0 lg:block', mobileTab === 'results' ? 'block' : 'hidden')}>
          {done && results.isLoading && (
            <div className="space-y-3">
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-72 w-full" />
            </div>
          )}
          {results.isError && (
            <Alert tone="danger" title="Could not load results">
              {results.error.message}
            </Alert>
          )}
          {done && results.data && (
            <ResultsView
              results={results.data}
              onShowPrimaryQuote={(p, quote) => {
                if (p) setPage(p);
                setHighlights([quote]);
                setMobileTab('document');
              }}
            />
          )}
          {!done && job.data?.status !== 'failed' && (
            <Card className="p-6 text-sm text-slate-500">
              <Spinner label="Results will appear here when verification completes." />
              <p className="mt-2 text-xs">
                You can leave or refresh this page — progress is tracked on the server.
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
