import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';

import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Highlighter,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';

import { highlightRanges } from '../lib/highlight';
import { scrollBehavior } from '../lib/utils';

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
 * PDF viewer with page navigation, zoom and exact quote highlighting (citation deep links).
 * `onClearHighlights` adds a "Clear highlight" control.
 */
export function PdfViewer({
  url,
  page,
  onPageChange,
  highlights = [],
  title,
  onClearHighlights,
}: {
  url: string;
  page: number;
  onPageChange: (p: number) => void;
  highlights?: string[];
  title: string;
  onClearHighlights?: (() => void) | undefined;
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

  // Exact quote highlighting: the page's text items are matched as a whole (see lib/highlight.ts)
  // and only the quoted characters are wrapped in <mark>.
  const [items, setItems] = useState<string[] | null>(null);
  const ranges = useMemo(
    () => (items ? highlightRanges(items, highlights) : new Map<number, [number, number][]>()),
    [items, highlights],
  );
  const renderText = useCallback(
    ({ str, itemIndex }: { str: string; itemIndex: number }) => {
      const marks = ranges.get(itemIndex);
      if (!marks) return escapeHtml(str);
      let html = '';
      let at = 0;
      for (const [a, b] of marks) {
        html += `${escapeHtml(str.slice(at, a))}<mark>${escapeHtml(str.slice(a, b))}</mark>`;
        at = b;
      }
      return html + escapeHtml(str.slice(at));
    },
    [ranges],
  );
  // Scroll to the highlight once per new citation, not on every re-render (zoom, paging).
  const scrolledFor = useRef<string | null>(null);
  const highlightKey = `${page}:${highlights.join('|')}`;
  const scrollToMark = useCallback(() => {
    if (scrolledFor.current === highlightKey) return;
    const mark = box.current?.querySelector('mark');
    if (!mark) return;
    scrolledFor.current = highlightKey;
    mark.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
  }, [highlightKey]);
  const notFound = Boolean(items) && highlights.length > 0 && ranges.size === 0;

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
      {highlights.length > 0 && (onClearHighlights || notFound) && (
        <div
          className="flex items-center justify-between gap-2 border-b border-slate-200 bg-yellow-50 px-3 py-1.5 text-xs text-slate-700"
          role="status"
        >
          <span className="inline-flex items-center gap-1.5">
            <Highlighter className="h-3.5 w-3.5" aria-hidden />
            {notFound ? 'The quote was not found on this page.' : 'Showing the cited quote.'}
          </span>
          {onClearHighlights && (
            <Button variant="ghost" size="sm" className="h-6 px-2" onClick={onClearHighlights}>
              <X className="h-3.5 w-3.5" aria-hidden /> Clear highlight
            </Button>
          )}
        </div>
      )}
      {/* Focusable so keyboard users can scroll the page image with the arrow keys (WCAG 2.1.1;
          axe scrollable-region-focusable). */}
      <div
        ref={box}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- scrollable region must be focusable
        tabIndex={0}
        role="region"
        aria-label={`${title}, page ${page}`}
        // A stable scrollbar gutter: the fit-to-width page no longer resizes (and re-wraps) when the
        // vertical scrollbar appears or disappears.
        className="min-h-0 flex-1 overflow-auto bg-slate-100 p-2 [scrollbar-gutter:stable] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600"
      >
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
              onGetTextSuccess={({ items: t }) =>
                setItems(t.map((it) => ('str' in it ? it.str : '')))
              }
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
