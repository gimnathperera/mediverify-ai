import type { DocumentDto } from '@mediverify/shared';
import { STAGE_LABELS } from '@mediverify/shared';
import { FileText, RefreshCw, Search } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';

import { JobStatusBadge } from '../components/status';
import { Alert, Button, Card, EmptyState, Input, Skeleton } from '../components/ui/primitives';
import { UploadPanel } from '../components/UploadPanel';
import { useDocuments, useReferences, useUploadDocument, type PendingUpload } from '../lib/queries';
import { usePageTitle } from '../lib/usePageTitle';
import { cn, formatBytes, formatDateTime } from '../lib/utils';

type StatusFilter = 'all' | 'processing' | 'completed' | 'failed';
const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'processing', label: 'Processing' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
];

function statusGroup(d: DocumentDto): Exclude<StatusFilter, 'all'> {
  const s = d.latestJob?.status;
  return s === 'completed' ? 'completed' : s === 'failed' ? 'failed' : 'processing';
}

/** Client-side filter over the loaded list (the API returns the latest 50). */
export function filterDocuments(docs: DocumentDto[], query: string, status: StatusFilter) {
  const q = query.trim().toLowerCase();
  return docs.filter(
    (d) =>
      (status === 'all' || statusGroup(d) === status) &&
      (!q || d.filename.toLowerCase().includes(q)),
  );
}

export function DocumentsPage() {
  const docs = useDocuments();
  const refs = useReferences();
  const navigate = useNavigate();
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const searchId = useId();
  usePageTitle('Documents');
  const all = docs.data;
  const shown = useMemo(() => filterDocuments(all ?? [], query, status), [all, query, status]);
  const countFor = (f: StatusFilter) =>
    f === 'all' ? (all?.length ?? 0) : (all ?? []).filter((d) => statusGroup(d) === f).length;
  const upload = useUploadDocument((tempId, progress) =>
    setPending((p) => p.map((x) => (x.tempId === tempId ? { ...x, progress } : x))),
  );

  const submit = (file: File, referenceId: string) => {
    const tempId = `tmp-${crypto.randomUUID()}`;
    // Optimistic card: shows the upload immediately; no pipeline stages are shown until the server accepts it.
    setPending((p) => [
      { tempId, filename: file.name, sizeBytes: file.size, progress: 0, error: null },
      ...p,
    ]);
    upload.mutate(
      { tempId, file, referenceId },
      {
        onSuccess: (r) => {
          setPending((p) => p.filter((x) => x.tempId !== tempId));
          toast.success(
            r.duplicate
              ? 'Same document uploaded recently — opening the existing job.'
              : 'Upload accepted — processing started.',
          );
          void navigate(`/documents/${r.documentId}`);
        },
        onError: (err) => {
          // Roll back the optimistic card into an explicit error state the user can dismiss.
          setPending((p) => p.map((x) => (x.tempId === tempId ? { ...x, error: err.message } : x)));
          toast.error(err.message);
        },
      },
    );
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
      <div>
        <UploadPanel
          references={refs.data}
          referencesLoading={refs.isLoading}
          onSubmit={submit}
          busy={upload.isPending}
        />
        {refs.isError && (
          <Alert tone="danger" title="Could not load reference documents" className="mt-3">
            {refs.error.message}
          </Alert>
        )}
      </div>
      <section aria-labelledby="history-h">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="history-h" className="font-semibold text-slate-900">
            Your documents
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void docs.refetch()}
            aria-label="Refresh list"
            loading={docs.isFetching && !docs.isLoading}
          >
            {!(docs.isFetching && !docs.isLoading) && <RefreshCw className="h-4 w-4" aria-hidden />}
          </Button>
        </div>
        {(all?.length ?? 0) > 0 && (
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <label htmlFor={searchId} className="sr-only">
                Search documents by file name
              </label>
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden
              />
              <Input
                id={searchId}
                type="search"
                placeholder="Search by file name"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <div
              className="flex gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white p-1"
              role="group"
              aria-label="Filter by status"
            >
              {FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  aria-pressed={status === f.value}
                  onClick={() => setStatus(f.value)}
                  className={cn(
                    'whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium focus-visible:outline-2 focus-visible:outline-brand-600',
                    status === f.value
                      ? 'bg-brand-700 text-white'
                      : 'text-slate-700 hover:bg-slate-100',
                  )}
                >
                  {f.label} <span className="tabular-nums">{countFor(f.value)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <ul className="space-y-2" aria-live="polite" aria-label="Documents">
          {pending.map((p) => (
            <li key={p.tempId}>
              <Card className={p.error ? 'border-rose-300 p-4' : 'p-4'}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <FileText className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{p.filename}</p>
                      <p className="text-xs text-slate-500">
                        {formatBytes(p.sizeBytes)} ·{' '}
                        {p.error ? 'Upload rejected' : `Uploading ${Math.round(p.progress * 100)}%`}
                      </p>
                    </div>
                  </div>
                  {p.error ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPending((x) => x.filter((y) => y.tempId !== p.tempId))}
                    >
                      Dismiss
                    </Button>
                  ) : (
                    <JobStatusBadge status="uploading" />
                  )}
                </div>
                {p.error && (
                  <p className="mt-2 text-sm text-rose-700" role="alert">
                    {p.error}
                  </p>
                )}
              </Card>
            </li>
          ))}
          {docs.isLoading &&
            [0, 1, 2].map((i) => (
              <li key={i}>
                <Skeleton className="h-[68px] w-full" />
              </li>
            ))}
          {docs.isError && (
            <li>
              <Alert
                tone="danger"
                title="Could not load your documents"
                action={
                  <Button size="sm" variant="outline" onClick={() => void docs.refetch()}>
                    Retry
                  </Button>
                }
              >
                {docs.error.message}
              </Alert>
            </li>
          )}
          {shown.map((d) => (
            <DocumentRow key={d.id} d={d} />
          ))}
        </ul>
        {(all?.length ?? 0) > 0 && shown.length === 0 && (
          <EmptyState icon={<Search className="h-8 w-8" />} title="No documents match">
            <Button
              variant="link"
              onClick={() => {
                setQuery('');
                setStatus('all');
              }}
            >
              Clear search and filters
            </Button>
          </EmptyState>
        )}
        {docs.data?.length === 0 && pending.length === 0 && (
          <EmptyState icon={<FileText className="h-8 w-8" />} title="No documents yet">
            Upload a discharge summary (PDF or DOCX) to start a verification job.
          </EmptyState>
        )}
      </section>
    </div>
  );
}

function DocumentRow({ d }: { d: DocumentDto }) {
  const job = d.latestJob;
  return (
    <li>
      <Link to={`/documents/${d.id}`} className="block rounded-xl focus-visible:outline-2">
        <Card className="p-4 transition-colors hover:border-brand-600">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-3">
              <FileText className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-900">{d.filename}</p>
                <p className="text-xs text-slate-600">
                  {formatDateTime(d.createdAt)} · {formatBytes(d.sizeBytes)} · vs{' '}
                  {d.reference.title} rev. {d.reference.versionLabel}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {job?.status === 'running' && job.currentStage && (
                <span className="text-xs text-slate-600">{STAGE_LABELS[job.currentStage]}</span>
              )}
              {job && <JobStatusBadge status={job.status} />}
            </div>
          </div>
          {job?.status === 'failed' && job.errorMessage && (
            <p className="mt-2 text-xs text-rose-700">{job.errorMessage}</p>
          )}
        </Card>
      </Link>
    </li>
  );
}
