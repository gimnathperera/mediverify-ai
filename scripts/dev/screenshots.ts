/**
 * Captures README screenshots from a running stack (default http://localhost:8088, fixture mode).
 * Usage: pnpm exec tsx scripts/dev/screenshots.ts [baseUrl]
 */
import { chromium, type Page } from '@playwright/test';

const BASE = process.argv[2] ?? 'http://localhost:8088';
const OUT = 'docs/screenshots';
const EMAIL = process.env.SEED_USER_EMAIL ?? 'reviewer@mediverify.test';
const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'Reviewer#2026';

const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.png` });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
await page.goto(`${BASE}/login`);
await page.getByLabel('Email').fill(EMAIL);
await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForURL(/\/documents$/);

const list = (await (
  await page.request.get(`${BASE}/api/documents?status=completed&q=primary_document_medical`)
).json()) as { items: { id: string; filename: string }[] };
const done = list.items.find((d) => d.filename === 'primary_document_medical.pdf');
if (!done) throw new Error('No completed primary_document_medical.pdf — upload it first');

await page.waitForTimeout(500);
await shot(page, 'documents');

await page.goto(`${BASE}/documents/${done.id}`);
await page.getByRole('heading', { name: 'Summary' }).waitFor();
await page.locator('.react-pdf__Page canvas').first().waitFor();
await page.waitForTimeout(800);
await shot(page, 'document-view');

await page.getByRole('button', { name: /Pipeline completed — 8\/8 stages/ }).click();
await page.waitForTimeout(400);
await shot(page, 'pipeline');
await page.getByRole('button', { name: /Pipeline completed — 8\/8 stages/ }).click();

await page.getByRole('button', { name: /Pravoxil › Prescribing notes, p\.5/ }).click();
await page.getByRole('dialog').getByText('Quote verified in source').waitFor();
await page.waitForTimeout(600);
await shot(page, 'citation');

await page.getByRole('dialog').getByRole('button', { name: 'View in reference document' }).click();
await page.getByRole('dialog').getByText('5 / 10').waitFor();
await page.waitForTimeout(1200);
await shot(page, 'reference-deep-link');

await browser.close();
console.log(`screenshots written to ${OUT}/`);
