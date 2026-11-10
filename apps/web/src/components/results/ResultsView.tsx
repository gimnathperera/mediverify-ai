import type { CitationDto, ResultsDto, VerificationStatus } from '@mediverify/shared';
import * as Tabs from '@radix-ui/react-tabs';
import { useEffect, useRef, useState } from 'react';

import { CitationSheet } from '../CitationSheet';

import { CriticalPointsList } from './CriticalPointsList';
import { verificationAnchor } from './labels';
import { MedicationsTable } from './MedicationsTable';
import { SummaryCard } from './SummaryCard';
import { VerificationPanel } from './VerificationPanel';

type Section = 'issues' | 'critical' | 'meds';

const TAB_CLASS =
  'whitespace-nowrap rounded-md px-3 py-1.5 text-sm text-slate-700 focus-visible:outline-2 focus-visible:outline-brand-600 data-[state=active]:bg-brand-700 data-[state=active]:text-white';

export function ResultsView({
  results,
  onShowPrimaryQuote,
}: {
  results: ResultsDto;
  onShowPrimaryQuote: (page: number | null, quote: string) => void;
}) {
  const [section, setSection] = useState<Section>('issues');
  const [filter, setFilter] = useState<VerificationStatus | null>(null);
  const [cite, setCite] = useState<{ c: CitationDto; heading: string } | null>(null);
  const pendingFocus = useRef<string | null>(null);

  // After switching to the verification tab from a critical point, move focus to that card.
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id || section !== 'issues') return;
    pendingFocus.current = null;
    // The tab panel mounts after this commit; look the card up on the next frame.
    const frame = requestAnimationFrame(() => {
      const el = document.getElementById(verificationAnchor(id));
      el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      el?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [section]);

  const flagged = results.verifications.filter(
    (v) => v.status === 'contradicted' || v.status === 'unsupported',
  ).length;

  return (
    <div className="space-y-4">
      <SummaryCard summary={results.summary} llm={results.llm} />

      <Tabs.Root value={section} onValueChange={(v) => setSection(v as Section)}>
        <Tabs.List
          className="flex gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white p-1"
          aria-label="Result sections"
        >
          <Tabs.Trigger value="issues" className={TAB_CLASS}>
            Verification{flagged ? ` · ${flagged} flagged` : ''}
          </Tabs.Trigger>
          <Tabs.Trigger value="critical" className={TAB_CLASS}>
            Critical points · {results.criticalPoints.length}
          </Tabs.Trigger>
          <Tabs.Trigger value="meds" className={TAB_CLASS}>
            Medications · {results.medications.length}
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="issues" className="mt-4">
          <VerificationPanel
            verifications={results.verifications}
            medications={results.medications}
            filter={filter}
            onFilterChange={setFilter}
            onCite={(c, heading) => setCite({ c, heading })}
          />
        </Tabs.Content>
        <Tabs.Content value="critical" className="mt-4">
          <CriticalPointsList
            points={results.criticalPoints}
            verifications={results.verifications}
            onShowPrimaryQuote={onShowPrimaryQuote}
            onShowVerification={(id) => {
              pendingFocus.current = id;
              setFilter(null);
              setSection('issues');
            }}
          />
        </Tabs.Content>
        <Tabs.Content value="meds" className="mt-4">
          <MedicationsTable
            medications={results.medications}
            onShowPrimaryQuote={onShowPrimaryQuote}
          />
        </Tabs.Content>
      </Tabs.Root>

      <CitationSheet
        citation={cite?.c ?? null}
        heading={cite?.heading ?? ''}
        onClose={() => setCite(null)}
      />
    </div>
  );
}
