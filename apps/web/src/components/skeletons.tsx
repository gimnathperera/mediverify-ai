/**
 * Loading placeholders shaped like the real sections, so the layout doesn't jump when data arrives.
 * Each top-level skeleton is a single `role="status"` region with a short screen-reader label; the
 * shapes themselves are hidden from assistive tech.
 */
import { ShieldCheck } from 'lucide-react';
import type * as React from 'react';

import { Card, LoadingRegion, Skeleton } from './ui/primitives';

export function DocumentRowSkeleton() {
  return (
    <Card className="flex items-center gap-3 p-4">
      <Skeleton className="h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-3 w-4/5" />
      </div>
      <Skeleton className="h-5 w-20 rounded-full" />
    </Card>
  );
}

export function DocumentListSkeleton({
  rows = 4,
  announce = true,
}: {
  rows?: number;
  announce?: boolean;
}) {
  return (
    <LoadingRegion label="Loading your documents" announce={announce} className="space-y-2">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <Skeleton className="h-10 flex-1" />
        <Skeleton className="h-10 w-full sm:w-72" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <DocumentRowSkeleton key={i} />
      ))}
    </LoadingRegion>
  );
}

export function UploadPanelSkeleton({ announce = true }: { announce?: boolean }) {
  return (
    <LoadingRegion label="Loading upload form" announce={announce}>
      <Card className="space-y-4 p-5">
        <div className="space-y-2">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-10 w-full" />
        </div>
        <Skeleton className="h-48 w-full rounded-xl" />
      </Card>
    </LoadingRegion>
  );
}

export function DocumentsPageSkeleton() {
  return (
    <LoadingRegion
      label="Loading documents"
      className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]"
    >
      <UploadPanelSkeleton announce={false} />
      <section>
        <div className="mb-3 flex items-center justify-between">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-8 w-8" />
        </div>
        <DocumentListSkeleton announce={false} />
      </section>
    </LoadingRegion>
  );
}

export function PdfViewerSkeleton({ announce = true }: { announce?: boolean }) {
  return (
    <LoadingRegion
      label="Loading document viewer"
      announce={announce}
      className="flex h-full flex-col"
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
        <Skeleton className="h-4 w-40" />
        <div className="flex gap-1.5">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-7 w-7" />
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-hidden bg-slate-100 p-4">
        <div className="mx-auto max-w-2xl space-y-3 rounded-sm bg-white p-8 shadow-sm">
          <Skeleton className="mx-auto h-5 w-1/2" />
          <Skeleton className="mx-auto h-3 w-1/3" />
          <div className="h-4" />
          {[90, 75, 85, 60, 95, 70, 80, 55].map((w, i) => (
            <Skeleton key={i} className="h-3" style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
    </LoadingRegion>
  );
}

export function ResultsSkeleton({ announce = true }: { announce?: boolean }) {
  return (
    <LoadingRegion label="Loading results" announce={announce} className="space-y-4">
      <Card className="space-y-3 p-5">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-40 rounded-full" />
        </div>
        {[100, 96, 92, 98, 70].map((w, i) => (
          <Skeleton key={i} className="h-3.5" style={{ width: `${w}%` }} />
        ))}
      </Card>
      <Skeleton className="h-10 w-full rounded-lg" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[72px] rounded-lg" />
        ))}
      </div>
      {[0, 1].map((i) => (
        <Card key={i} className="space-y-2 border-l-4 border-l-slate-200 p-4">
          <div className="flex justify-between">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-5 w-24 rounded-full" />
          </div>
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-14 w-full rounded-lg" />
        </Card>
      ))}
    </LoadingRegion>
  );
}

export function DocumentPageSkeleton() {
  return (
    <LoadingRegion label="Loading document" className="space-y-4">
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-9" />
        <Skeleton className="h-5 w-5" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-64 max-w-full" />
          <Skeleton className="h-3 w-96 max-w-full" />
        </div>
        <Skeleton className="h-6 w-24 rounded-full" />
      </div>
      <Skeleton className="h-10 w-full rounded-xl" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="hidden h-[75vh] overflow-hidden lg:block">
          <PdfViewerSkeleton announce={false} />
        </Card>
        <ResultsSkeleton announce={false} />
      </div>
    </LoadingRegion>
  );
}

/** Shown while the session is checked: the app frame with the page's own skeleton inside. */
export function ShellSkeleton({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between px-4">
          <span className="flex items-center gap-2 font-semibold text-slate-900">
            <ShieldCheck className="h-6 w-6 text-brand-700" aria-hidden />
            MediVerify
          </span>
          <Skeleton className="h-8 w-40" />
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
