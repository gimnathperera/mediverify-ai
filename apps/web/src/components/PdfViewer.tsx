import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';

import { ChevronLeft, ChevronRight, ExternalLink, ZoomIn, ZoomOut } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';

import { normalizeText } from '../lib/utils';

import { Alert, Button, Skeleton } from './ui/primitives';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

function escapeHtml(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/**
 * PDF viewer with page navigation, zoom and quote highlighting: any text-layer run that is part of
 * one of the highlight quotes is wrapped in <mark> (used for citation deep links).
 */
export function PdfViewer({
  url,
  page,
  onPageChange,
  highlights = [],
  title,
}: {
  url: string;
  page: number;
  onPageChange: (p: number) => void;
  highlights?: string[];
  title: string;
}) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(600);
  const [zoom, setZoom] = useState(1);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) =>
      setWidth(Math.max(280, Math.floor(entry!.contentRect.width) - 2)),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Highlight matching: a text run is marked if it contains a quote verbatim (only that span is
  // wrapped) or shares a run of ≥5 consecutive words with a quote (multi-line quotes span runs).
  const needles = useMemo(
    () =>
      highlights
        .map(normalizeText)
        .filter((h) => h.length > 3)
        .map((q) => {
          const words = q.split(' ');
          const shingles = new Set<string>();
          for (let i = 0; i + 5 <= words.length; i++) shingles.add(words.slice(i, i + 5).join(' '));
          return { q, shingles };
        }),
    [highlights],
  );
  const renderText = useCallback(
    ({ str }: { str: string }) => {
      const n = normalizeText(str);
      for (const { q, shingles } of needles) {
        const lower = str.toLowerCase();
        const idx = lower.indexOf(q);
        if (idx >= 0) {
          return `${escapeHtml(str.slice(0, idx))}<mark>${escapeHtml(str.slice(idx, idx + q.length))}</mark>${escapeHtml(str.slice(idx + q.length))}`;
        }
        const words = n.split(' ');
        for (let i = 0; i + 5 <= words.length; i++) {
          if (shingles.has(words.slice(i, i + 5).join(' ')))
            return `<mark>${escapeHtml(str)}</mark>`;
        }
        if (words.length >= 3 && words.length < 5 && q.includes(n))
          return `<mark>${escapeHtml(str)}</mark>`;
      }
      return escapeHtml(str);
    },
    [needles],
  );
  const scrollToMark = useCallback(() => {
    box.current?.querySelector('mark')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, []);

  const file = useMemo(() => ({ url, withCredentials: true }), [url]);
  const go = (p: number) => onPageChange(Math.min(Math.max(1, p), numPages ?? 1));

  return (
    <section aria-label={title} className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
        <p className="truncate text-sm font-medium text-slate-700" title={title}>
          {title}
        </p>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => go(page - 1)}
            disabled={page <= 1}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span
            className="min-w-[72px] text-center text-xs tabular-nums text-slate-600"
            aria-live="polite"
          >
            {numPages ? `${page} / ${numPages}` : '…'}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => go(page + 1)}
            disabled={!numPages || page >= numPages}
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setZoom((z) => Math.max(0.6, z - 0.2))}
            aria-label="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setZoom((z) => Math.min(2.4, z + 0.2))}
            aria-label="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" asChild aria-label="Open PDF in new tab">
            <a href={url} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        </div>
      </div>
      <div ref={box} className="min-h-0 flex-1 overflow-auto bg-slate-100 p-2">
        {error ? (
          <Alert tone="danger" title="Could not display the document">
            {error}
          </Alert>
        ) : (
          <Document
            file={file}
            onLoadSuccess={(d) => {
              setNumPages(d.numPages);
              if (page > d.numPages) onPageChange(1);
            }}
            onLoadError={(e) => setError(e.message || 'The PDF could not be loaded.')}
            loading={<Skeleton className="mx-auto h-[70vh] w-full max-w-3xl" />}
          >
            <Page
              pageNumber={page}
              width={Math.round(width * zoom)}
              customTextRenderer={renderText}
              onRenderTextLayerSuccess={scrollToMark}
              className="mx-auto shadow"
              loading={<Skeleton className="mx-auto h-[70vh] w-full max-w-3xl" />}
            />
          </Document>
        )}
      </div>
    </section>
  );
}
