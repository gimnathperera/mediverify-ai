import {
  DOCX_MIME,
  extensionOf,
  MAX_UPLOAD_BYTES,
  PDF_MIME,
  sniffDocumentType,
  type ReferenceDto,
} from '@mediverify/shared';
import { FileUp, Info } from 'lucide-react';
import { useId, useRef, useState } from 'react';

import { cn, formatBytes } from '../lib/utils';

import { Alert, Button, Card, Label } from './ui/primitives';

export async function validateFile(file: File): Promise<string | null> {
  const ext = extensionOf(file.name);
  if (ext !== '.pdf' && ext !== '.docx')
    return 'Only PDF (.pdf) and Word (.docx) files are supported.';
  if (file.size === 0) return 'The file is empty.';
  if (file.size > MAX_UPLOAD_BYTES)
    return `The file is ${formatBytes(file.size)}; the limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`;
  const head = new Uint8Array(await file.slice(0, Math.min(file.size, 65536)).arrayBuffer());
  // DOCX entry names may appear late in the zip; only reject DOCX when it is not even a zip.
  const sniffed = sniffDocumentType(head);
  if (ext === '.pdf' && sniffed !== 'pdf') return 'This file does not look like a valid PDF.';
  if (ext === '.docx' && !(head[0] === 0x50 && head[1] === 0x4b))
    return 'This file does not look like a valid DOCX document.';
  return null;
}

export function UploadPanel({
  references,
  referencesLoading,
  onSubmit,
  busy,
}: {
  references: ReferenceDto[] | undefined;
  referencesLoading: boolean;
  onSubmit: (file: File, referenceId: string) => void;
  busy: boolean;
}) {
  const inputId = useId();
  const selectId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRef, setSelectedRef] = useState<string>('');
  const refId = selectedRef || references?.[0]?.id || '';
  const ref = references?.find((r) => r.id === refId);

  const handle = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    const problem = await validateFile(file);
    if (problem) {
      setError(problem);
      return;
    }
    if (!refId) {
      setError('Select a reference document first.');
      return;
    }
    onSubmit(file, refId);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <Card className="p-5">
      <h2 className="font-semibold text-slate-900">Verify a discharge document</h2>
      <p className="mt-1 text-sm text-slate-600">
        Upload the primary document; it is verified against the selected institutional reference.
      </p>

      <div className="mt-4 space-y-1.5">
        <Label htmlFor={selectId}>Reference document</Label>
        <select
          id={selectId}
          className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm disabled:opacity-60"
          value={refId}
          onChange={(e) => setSelectedRef(e.target.value)}
          disabled={referencesLoading || !references?.length}
        >
          {referencesLoading && <option>Loading references…</option>}
          {!referencesLoading && !references?.length && (
            <option>No reference documents available</option>
          )}
          {references?.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title} — rev. {r.versionLabel}
            </option>
          ))}
        </select>
        {ref && (
          <p className="flex items-center gap-1 text-xs text-slate-600">
            <Info className="h-3.5 w-3.5" aria-hidden />
            {ref.indexStatus === 'ready'
              ? `Indexed: ${ref.monographCount} monographs`
              : `Index status: ${ref.indexStatus} (will be built on first use)`}
          </p>
        )}
      </div>

      {/* The whole zone accepts clicks and drops; the button is the keyboard entry point. */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        className={cn(
          'mt-4 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors focus-within:border-brand-600 motion-reduce:transition-none',
          drag
            ? 'border-brand-600 bg-brand-50'
            : 'border-slate-300 bg-slate-50 hover:border-slate-400',
          (!refId || busy) && 'cursor-not-allowed opacity-70',
        )}
        onClick={(e) => {
          if (e.target === e.currentTarget && refId && !busy) inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void handle(e.dataTransfer.files[0]);
        }}
      >
        <FileUp className="h-8 w-8 text-slate-400" aria-hidden />
        <p className="text-sm text-slate-700">
          Drag &amp; drop a <strong>PDF</strong> or <strong>DOCX</strong> here
        </p>
        <p className="text-xs text-slate-600">
          Max {formatBytes(MAX_UPLOAD_BYTES)} · processed in the background, so you can leave the
          page
        </p>
        <input
          ref={inputRef}
          id={inputId}
          aria-label="Choose a PDF or DOCX file to verify"
          tabIndex={-1}
          type="file"
          accept={`.pdf,.docx,${PDF_MIME},${DOCX_MIME}`}
          className="sr-only"
          onChange={(e) => void handle(e.target.files?.[0])}
          data-testid="file-input"
        />
        <Button
          type="button"
          variant="outline"
          aria-describedby={error ? errorId : undefined}
          onClick={() => inputRef.current?.click()}
          loading={busy}
          disabled={!refId}
        >
          Choose file
        </Button>
      </div>
      {error && (
        <div id={errorId} className="mt-3">
          <Alert tone="danger" title="File rejected">
            {error}
          </Alert>
        </div>
      )}
    </Card>
  );
}
