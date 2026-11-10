import { lazy, Suspense, type ComponentProps } from 'react';

import type { PdfViewer as PdfViewerComponent } from './PdfViewer';
import { Spinner } from './ui/primitives';

// react-pdf + pdf.js are the largest part of the app; load them only when a document is opened.
const PdfViewerImpl = lazy(() => import('./PdfViewer').then((m) => ({ default: m.PdfViewer })));

export function PdfViewer(props: ComponentProps<typeof PdfViewerComponent>) {
  return (
    <Suspense
      fallback={
        <div className="flex h-64 items-center justify-center">
          <Spinner label="Loading document viewer" />
        </div>
      }
    >
      <PdfViewerImpl {...props} />
    </Suspense>
  );
}
