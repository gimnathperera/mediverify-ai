import { lazy, Suspense, type ComponentProps } from 'react';

import type { PdfViewer as PdfViewerComponent } from './PdfViewer';
import { PdfViewerSkeleton } from './skeletons';

// react-pdf + pdf.js are the largest part of the app; load them only when a document is opened.
const PdfViewerImpl = lazy(() => import('./PdfViewer').then((m) => ({ default: m.PdfViewer })));

export function PdfViewer(props: ComponentProps<typeof PdfViewerComponent>) {
  return (
    <Suspense fallback={<PdfViewerSkeleton />}>
      <PdfViewerImpl {...props} />
    </Suspense>
  );
}
