/** Dev helper: print monographs + parsed rules for a reference PDF. */
import { readFileSync } from 'node:fs';

import { chunkReference, parsePdf } from '@mediverify/core';

const doc = await parsePdf(
  readFileSync(process.argv[2] ?? 'resources/reference_document_medical.pdf'),
);
const { monographs, chunks } = chunkReference(doc);
for (const m of monographs) {
  const r = m.rules;
  console.log(
    `${m.name} [${m.nameNormalized}] p${m.pageStart} §${m.sectionTitle} aliases=${m.aliases.join(',')}`,
  );
  console.log(
    `  std=${r.standardDose?.value}${r.standardDose?.unit} ${r.standardDose?.frequency} ${r.standardDose?.route} timing=${r.standardDose?.timing}`,
  );
  console.log(
    `  max=${r.maxDose?.value} daily=${r.maxDailyDose?.value} reduced=${r.reducedInitialDoses.map((d) => d.value).join(',')} titr=${JSON.stringify(r.titration && { inc: r.titration.incrementValue, wk: r.titration.minIntervalWeeks })}`,
  );
  console.log(
    `  reqTiming=${r.requiredTiming?.timing} forbid=${r.forbiddenTimings.map((f) => f.timing).join(',')} maxDur=${r.maxDurationWeeks?.value} (${r.maxDurationWeeks?.evidence.quote.slice(0, 60)}) reassess=${r.reassessmentWeeks?.value}`,
  );
}
console.log(
  chunks
    .map((c) => `${c.ordinal}:${c.kind}${c.fieldLabel ? '/' + c.fieldLabel : ''}@p${c.pageStart}`)
    .join(' '),
);
