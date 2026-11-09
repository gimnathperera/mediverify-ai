import type { DocumentDto } from '@mediverify/shared';
import { STAGE_LABELS } from '@mediverify/shared';
import { FileText, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';

import { JobStatusBadge } from '../components/status';
import { Alert, Button, Card, EmptyState, Skeleton } from '../components/ui/primitives';
import { UploadPanel } from '../components/UploadPanel';
import { useDocuments, useReferences, useUploadDocument, type PendingUpload } from '../lib/queries';
import { formatBytes, formatDateTime } from '../lib/utils';

export function DocumentsPage() {
  const docs = useDocuments();
  const refs = useReferences();
  const navigate = useNavigate();
  const [pending, setPending] = useState<PendingUpload[]>([]);
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
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        <ul className="space-y-2" aria-live="polite">
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
          {docs.data?.map((d) => (
            <DocumentRow key={d.id} d={d} />
          ))}
        </ul>
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
                <p className="text-xs text-slate-500">
                  {formatDateTime(d.createdAt)} · {formatBytes(d.sizeBytes)} · vs{' '}
                  {d.reference.title} rev. {d.reference.versionLabel}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {job?.status === 'running' && job.currentStage && (
                <span className="text-xs text-slate-500">{STAGE_LABELS[job.currentStage]}</span>
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
