import type { CitationDto, ResultsDto, VerificationStatus } from '@mediverify/shared/client';
import * as Tabs from '@radix-ui/react-tabs';
import { useEffect, useState } from 'react';

import { scrollBehavior } from '../../lib/utils';
import { CitationSheet } from '../CitationSheet';
import { TAB_ITEM, TabIndicator, useTabIndicator } from '../ui/tab-indicator';

import { CriticalPointsList } from './CriticalPointsList';
import { verificationAnchor } from './labels';
import { MedicationsTable } from './MedicationsTable';
import { SummaryCard } from './SummaryCard';
import { VerificationPanel } from './VerificationPanel';

type Section = 'issues' | 'critical' | 'meds';

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
  // A request to show one medication's card; `n` makes repeated requests for the same card distinct.
  const [focusRequest, setFocusRequest] = useState<{ id: string; n: number } | null>(null);
  const { listRef: tabList, indicatorRef: tabIndicator } = useTabIndicator<HTMLDivElement>(section);

  // Scroll to and focus a medication card (from a critical point or the "Needs attention" panel).
  useEffect(() => {
    if (!focusRequest || section !== 'issues') return;
    // The tab panel may mount after this commit; look the card up on the next frame.
    const frame = requestAnimationFrame(() => {
      const el = document.getElementById(verificationAnchor(focusRequest.id));
      el?.scrollIntoView({ block: 'start', behavior: scrollBehavior() });
      el?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequest, section]);
  const showVerification = (id: string) => {
    setFilter(null);
    setSection('issues');
    setFocusRequest((r) => ({ id, n: (r?.n ?? 0) + 1 }));
  };

  const flagged = results.verifications.filter(
    (v) => v.status === 'contradicted' || v.status === 'unsupported',
  ).length;

  return (
    <div className="space-y-4">
      <SummaryCard summary={results.summary} llm={results.llm} />

      <Tabs.Root value={section} onValueChange={(v) => setSection(v as Section)}>
        <Tabs.List
          ref={tabList}
          className="relative flex gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white p-1"
          aria-label="Result sections"
        >
          <TabIndicator ref={tabIndicator} />
          <Tabs.Trigger value="issues" className={TAB_ITEM}>
            Verification{flagged ? ` · ${flagged} flagged` : ''}
          </Tabs.Trigger>
          <Tabs.Trigger value="critical" className={TAB_ITEM}>
            Critical points · {results.criticalPoints.length}
          </Tabs.Trigger>
          <Tabs.Trigger value="meds" className={TAB_ITEM}>
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
            onShowVerification={showVerification}
          />
        </Tabs.Content>
        <Tabs.Content value="critical" className="mt-4">
          <CriticalPointsList
            points={results.criticalPoints}
            verifications={results.verifications}
            onShowPrimaryQuote={onShowPrimaryQuote}
            onShowVerification={showVerification}
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
