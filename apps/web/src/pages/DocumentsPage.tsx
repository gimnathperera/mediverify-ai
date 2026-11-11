import {
  DOCUMENT_STATUS_FILTERS,
  STAGE_LABELS,
  type DocumentDto,
  type DocumentStatusFilter,
} from '@mediverify/shared/client';
import { FileText, RefreshCw, Search, X } from 'lucide-react';
import { memo, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { DocumentListSkeleton } from '../components/skeletons';
import { JobStatusBadge } from '../components/status';
import { Alert, Button, Card, EmptyState, Input } from '../components/ui/primitives';
import { TabIndicator, useTabIndicator } from '../components/ui/tab-indicator';
import { UploadPanel } from '../components/UploadPanel';
import { useDebouncedValue, useOnVisible } from '../lib/hooks';
import {
  useDocumentPages,
  useReferences,
  useUploadDocument,
  type PendingUpload,
} from '../lib/queries';
import { notify } from '../lib/toast';
import { usePageTitle } from '../lib/usePageTitle';
import { cn, formatBytes, formatDateTime, prefersReducedMotion } from '../lib/utils';

/** Matches the server's `q` limit (documentListQuerySchema). */
const SEARCH_MAX_LENGTH = 200;

const FILTER_LABEL: Record<DocumentStatusFilter, string> = {
  all: 'All',
  processing: 'Processing',
  completed: 'Completed',
  failed: 'Failed',
};

export function DocumentsPage() {
  const refs = useReferences();
  const navigate = useNavigate();
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<DocumentStatusFilter>('all');
  // Search and status filter run on the server; typing is debounced.
  const q = useDebouncedValue(query.trim(), 250);
  const docs = useDocumentPages({ status, q });
  const searchId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const { listRef: filterList, indicatorRef: filterIndicator } =
    useTabIndicator<HTMLDivElement>(status);
  const [refreshing, setRefreshing] = useState(false);
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  usePageTitle('Documents');
  const shown = docs.data?.pages.flatMap((p) => p.items) ?? [];
  const counts = docs.data?.pages[0]?.counts;
  // While new results load, the previous ones stay on screen (placeholder data) — dimmed, not swapped.
  const stale = docs.isPlaceholderData;
  // Counts are per search, so "the user has no documents" is only known from a settled, unfiltered
  // result. Until then (typing, debounce, fetch) the search bar stays mounted and keeps focus.
  const filtering = query !== '' || q !== '' || status !== 'all';
  const settledUnfiltered = Boolean(docs.data) && !stale && !filtering;
  const showToolbar = !(settledUnfiltered && counts?.all === 0);
  const noDocuments = settledUnfiltered && counts?.all === 0 && pending.length === 0;
  const noMatches = Boolean(docs.data) && !stale && filtering && shown.length === 0;

  const refresh = () => {
    setRefreshing(true);
    void docs.refetch().finally(() => setRefreshing(false));
  };
  const removePending = (tempId: string) => {
    setPending((p) => p.filter((x) => x.tempId !== tempId));
    setLeaving((s) => {
      const next = new Set(s);
      next.delete(tempId);
      return next;
    });
  };
  // Fade a dismissed card out, then remove it (onAnimationEnd, with a timer in case the event never
  // fires, e.g. in a background tab); reduced motion removes it at once.
  const dismiss = (tempId: string) => {
    if (prefersReducedMotion()) return removePending(tempId);
    setLeaving((s) => new Set(s).add(tempId));
    window.setTimeout(() => removePending(tempId), 250);
  };
  const loadMore = () => {
    if (docs.hasNextPage && !docs.isFetchingNextPage) void docs.fetchNextPage();
  };
  // Load the next page when the end of the list scrolls into view ("Load more" is the fallback).
  const sentinel = useOnVisible<HTMLDivElement>(loadMore, Boolean(docs.hasNextPage));
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
          if (r.duplicate)
            notify.info('You uploaded this document recently — opening the existing job.');
          else notify.success('Upload accepted — processing started.');
          void navigate(`/documents/${r.documentId}`);
        },
        onError: (err) => {
          // Roll back the optimistic card into an explicit error state the user can dismiss.
          setPending((p) => p.map((x) => (x.tempId === tempId ? { ...x, error: err.message } : x)));
          notify.error(err.message);
        },
      },
    );
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
      {/* The upload panel stays in view while the document list scrolls. */}
      <div className="lg:sticky lg:top-20 lg:self-start">
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
          {/* Spins only for a refresh the user asked for, not for search fetches or background polls. */}
          <Button
            variant="ghost"
            size="sm"
            onClick={refresh}
            aria-label="Refresh list"
            loading={refreshing}
          >
            {!refreshing && <RefreshCw className="h-4 w-4" aria-hidden />}
          </Button>
        </div>
        {showToolbar && (
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
                ref={searchRef}
                id={searchId}
                type="search"
                maxLength={SEARCH_MAX_LENGTH}
                placeholder="Search by file name"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && query) {
                    e.preventDefault();
                    setQuery('');
                  }
                }}
                className="pl-9 pr-10"
              />
              {query && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Clear search"
                  className="absolute right-1.5 top-1/2 h-7 w-7 -translate-y-1/2 text-slate-500 hover:text-slate-900"
                  onClick={() => {
                    setQuery('');
                    searchRef.current?.focus();
                  }}
                >
                  <X className="h-4 w-4" aria-hidden />
                </Button>
              )}
            </div>
            <div
              ref={filterList}
              className="relative flex gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white p-1"
              role="group"
              aria-label="Filter by status"
            >
              <TabIndicator ref={filterIndicator} />
              {DOCUMENT_STATUS_FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={status === f}
                  onClick={() => setStatus(f)}
                  className="relative z-10 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors duration-200 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-brand-600 aria-[pressed=false]:hover:bg-slate-100 aria-pressed:text-white"
                >
                  {FILTER_LABEL[f]} <span className="tabular-nums">{counts?.[f] ?? 0}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {docs.isLoading && <DocumentListSkeleton />}
        {/* Scrolls inside its own area once the list is longer than the viewport. */}
        <div className="-m-1 max-h-[70dvh] overflow-y-auto overscroll-contain p-1 lg:max-h-[calc(100dvh-16rem)]">
          {/* Announce a short summary, not the whole list, when results change. */}
          <p className="sr-only" aria-live="polite">
            {docs.data &&
              !stale &&
              `${shown.length} of ${counts?.[status] ?? shown.length} documents shown`}
          </p>
          <ul
            className={cn(
              'space-y-2 transition-opacity duration-200 motion-reduce:transition-none',
              stale && 'opacity-60',
            )}
            aria-label="Documents"
            aria-busy={stale || undefined}
          >
            {pending.map((p) => (
              <li
                key={p.tempId}
                className={leaving.has(p.tempId) ? 'list-item-out' : 'list-item-in'}
                onAnimationEnd={() => {
                  if (leaving.has(p.tempId)) removePending(p.tempId);
                }}
              >
                <Card className={p.error ? 'border-rose-300 p-4' : 'p-4'}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <FileText className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{p.filename}</p>
                        <p className="text-xs text-slate-500">
                          {formatBytes(p.sizeBytes)} ·{' '}
                          {p.error
                            ? 'Upload rejected'
                            : `Uploading ${Math.round(p.progress * 100)}%`}
                        </p>
                      </div>
                    </div>
                    {p.error ? (
                      <Button variant="ghost" size="sm" onClick={() => dismiss(p.tempId)}>
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
          {docs.hasNextPage && (
            <div ref={sentinel} className="flex justify-center py-3">
              <Button
                variant="outline"
                size="sm"
                onClick={loadMore}
                loading={docs.isFetchingNextPage}
              >
                Load more
              </Button>
            </div>
          )}
          {noMatches && (
            <EmptyState
              className="list-item-in"
              icon={<Search className="h-8 w-8" />}
              title="No documents match"
            >
              <Button
                variant="link"
                onClick={() => {
                  setQuery('');
                  setStatus('all');
                  searchRef.current?.focus();
                }}
              >
                Clear search and filters
              </Button>
            </EmptyState>
          )}
        </div>
        {noDocuments && (
          <EmptyState
            className="list-item-in"
            icon={<FileText className="h-8 w-8" />}
            title="No documents yet"
          >
            Upload a discharge summary (PDF or DOCX) to start a verification job.
          </EmptyState>
        )}
      </section>
    </div>
  );
}

/** Memoised: query results are structurally shared, so unchanged rows skip re-rendering on search. */
const DocumentRow = memo(function DocumentRow({ d }: { d: DocumentDto }) {
  const job = d.latestJob;
  return (
    <li className="list-item-in">
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
});
