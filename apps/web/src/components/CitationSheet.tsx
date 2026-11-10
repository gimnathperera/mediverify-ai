import type { CitationDto } from '@mediverify/shared';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

import { api } from '../lib/api';
import { normalizeText } from '../lib/utils';

import { PdfViewer } from './LazyPdfViewer';
import { Alert, Badge, Button, Skeleton } from './ui/primitives';
import { Sheet } from './ui/sheet';

/** Render chunk text with the cited quote emphasised (case/space-insensitive match). */
function HighlightedText({ text, quote }: { text: string; quote: string }) {
  const nt = normalizeText(text);
  const nq = normalizeText(quote);
  const idx = nq ? nt.indexOf(nq) : -1;
  if (idx < 0) return <p className="whitespace-pre-wrap">{text}</p>;
  // Map normalized offsets back to original text by walking characters (whitespace-collapse aware).
  let o = 0;
  let n = 0;
  let start = -1;
  let end = text.length;
  const norm = (c: string) => normalizeText(c) || ' ';
  while (o < text.length) {
    if (n === idx && start < 0) start = o;
    if (n === idx + nq.length) {
      end = o;
      break;
    }
    const isSpace = /\s/.test(text[o]!);
    if (isSpace && o > 0 && /\s/.test(text[o - 1]!)) {
      o++;
      continue;
    }
    n += norm(text[o]!).length;
    o++;
  }
  if (start < 0) return <p className="whitespace-pre-wrap">{text}</p>;
  return (
    <p className="whitespace-pre-wrap">
      {text.slice(0, start)}
      <mark className="rounded bg-yellow-200 px-0.5">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </p>
  );
}

export function CitationSheet({
  citation,
  onClose,
  heading,
}: {
  citation: CitationDto | null;
  onClose: () => void;
  heading: string;
}) {
  const [showRef, setShowRef] = useState(false);
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['chunk', citation?.referenceId, citation?.chunkId],
    queryFn: () => api.chunk(citation!.referenceId, citation!.chunkId),
    enabled: Boolean(citation),
    staleTime: Infinity,
  });

  if (!citation) return null;
  const location = [citation.monographName, citation.fieldLabel ?? citation.section]
    .filter(Boolean)
    .join(' › ');

  return (
    <>
      <Sheet
        open={!showRef}
        onOpenChange={(o) => !o && onClose()}
        title={heading}
        description={`Reference evidence — ${location || 'reference passage'}${citation.page ? `, page ${citation.page}` : ''}`}
      >
        <div className="space-y-5 p-5">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {citation.monographName && (
              <>
                <dt className="text-slate-500">Monograph</dt>
                <dd className="font-medium">{citation.monographName}</dd>
              </>
            )}
            {citation.section && (
              <>
                <dt className="text-slate-500">Section</dt>
                <dd>{citation.section}</dd>
              </>
            )}
            {citation.fieldLabel && (
              <>
                <dt className="text-slate-500">Field</dt>
                <dd>{citation.fieldLabel}</dd>
              </>
            )}
            <dt className="text-slate-500">Page</dt>
            <dd>{citation.page ?? '—'}</dd>
            <dt className="text-slate-500">Evidence</dt>
            <dd>
              {citation.quoteValid ? (
                <Badge tone="success">
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                  Quote verified in source
                </Badge>
              ) : (
                <Badge tone="danger">
                  <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
                  Quote NOT found in source — rejected
                </Badge>
              )}
            </dd>
          </dl>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Quoted passage
            </h3>
            <blockquote className="mt-2 border-l-4 border-yellow-400 bg-yellow-50 px-4 py-3 text-sm text-slate-800">
              “{citation.quote}”
            </blockquote>
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Full retrieved passage
            </h3>
            <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-800">
              {q.isLoading && <Skeleton className="h-24 w-full" />}
              {q.isError && (
                <Alert tone="danger" title="Could not load the passage">
                  {q.error.message}
                </Alert>
              )}
              {q.data && <HighlightedText text={q.data.text} quote={citation.quote} />}
            </div>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setPage(citation.page ?? 1);
              setShowRef(true);
            }}
          >
            <BookOpen className="h-4 w-4" aria-hidden /> View in reference document
          </Button>
        </div>
      </Sheet>
      <Sheet
        open={showRef}
        onOpenChange={(o) => {
          if (!o) setShowRef(false);
        }}
        wide
        title="Reference document"
        description={`${location}${citation.page ? ` — page ${citation.page}` : ''} (highlighted)`}
      >
        <div className="h-full min-h-[70vh]">
          <PdfViewer
            url={`/api/references/${citation.referenceId}/file`}
            page={page}
            onPageChange={setPage}
            highlights={[citation.quote]}
            title="Institutional formulary"
          />
        </div>
      </Sheet>
    </>
  );
}
