#!/usr/bin/env node
/**
 * Bundle-size budget for the web app (gzip sizes). Run after `pnpm --filter @mediverify/web build`.
 * Budgets sit a little above today's sizes so growth is a conscious decision, not an accident.
 * The pdf.js worker is excluded: it loads in a Web Worker only when a PDF is opened.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = path.resolve(import.meta.dirname, '../apps/web/dist');
const KB = 1024;
const BUDGET = {
  entryJs: 160 * KB, // everything needed for the first paint (sign-in, shell, router, query)
  entryCss: 10 * KB,
  lazyJs: 140 * KB, // any code-split chunk (largest: react-pdf viewer)
};

const html = readFileSync(path.join(DIST, 'index.html'), 'utf8');
const entry = new Set([...html.matchAll(/(?:src|href)="\/assets\/([^"]+)"/g)].map((m) => m[1]));
const gz = (file) => gzipSync(readFileSync(path.join(DIST, 'assets', file))).length;

const rows = [];
for (const file of readdirSync(path.join(DIST, 'assets'))) {
  if (file.startsWith('pdf.worker')) continue;
  const ext = path.extname(file);
  if (ext !== '.js' && ext !== '.css') continue;
  const kind = entry.has(file)
    ? ext === '.js'
      ? 'entryJs'
      : 'entryCss'
    : ext === '.js'
      ? 'lazyJs'
      : null;
  if (!kind) continue;
  const size = gz(file);
  rows.push({ file, kind, size, budget: BUDGET[kind], ok: size <= BUDGET[kind] });
}

for (const r of rows.sort((a, b) => b.size - a.size))
  console.log(
    `${r.ok ? '✓' : '✗'} ${r.kind.padEnd(8)} ${(r.size / KB).toFixed(1).padStart(6)} KB gz / ${r.budget / KB} KB  ${r.file}`,
  );
const over = rows.filter((r) => !r.ok);
if (over.length) {
  console.error(
    `\nBundle budget exceeded by ${over.length} file(s). Code-split or raise the budget deliberately.`,
  );
  process.exit(1);
}
