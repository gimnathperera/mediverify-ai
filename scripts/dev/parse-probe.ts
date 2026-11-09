/** Dev helper: print the parsed block structure of a PDF. Usage: tsx scripts/dev/parse-probe.ts <file.pdf> */
import { readFileSync } from 'node:fs';

import { parsePdf } from '@mediverify/core';

const file = process.argv[2];
if (!file) throw new Error('usage: parse-probe <file.pdf>');
const doc = await parsePdf(readFileSync(file));
for (const b of doc.blocks) {
  if (b.kind === 'table') {
    console.log(`[p${b.page}] TABLE headers=${JSON.stringify(b.table!.headers)}`);
    for (const r of b.table!.rows) console.log(`   ROW p${r.page}`, JSON.stringify(r.cells));
  } else {
    const label = b.label ? ` <${b.label}>` : '';
    console.log(
      `[p${b.page}] ${b.kind.toUpperCase()}${b.level ?? ''}${label} ${b.text.slice(0, 90)}`,
    );
  }
}
