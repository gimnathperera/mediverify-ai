import path from 'node:path';

import { expect, test } from '@playwright/test';

const PRIMARY = path.resolve(import.meta.dirname, '../../resources/primary_document_medical.pdf');
const EMAIL = process.env.SEED_USER_EMAIL ?? 'reviewer@mediverify.test';
const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'Reviewer#2026';

test('reviewer flow: login → upload → live pipeline → verification → citation', async ({
  page,
  isMobile,
}) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText(/Demo only/).first()).toBeVisible();

  // Invalid credentials show an error state.
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password', { exact: true }).fill('definitely-wrong');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('Invalid email or password');

  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/documents$/);

  // Client-side validation rejects a non-PDF/DOCX file without hitting the server.
  await page
    .getByTestId('file-input')
    .setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.getByText('File rejected')).toBeVisible();

  await page.getByTestId('file-input').setInputFiles(PRIMARY);
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}$/);

  // Pipeline reaches a terminal state; a refresh mid-way must not lose state.
  await page.reload();
  await expect(page.getByRole('button', { name: /Pipeline completed — 8\/8 stages/ })).toBeVisible({
    timeout: 110_000,
  });

  if (isMobile) await page.getByRole('tab', { name: 'Results' }).click();
  await expect(page.getByRole('heading', { name: 'Summary' })).toBeVisible();
  if (!isMobile) await expect(page.locator('.react-pdf__Page canvas').first()).toBeVisible(); // viewer renders
  await expect(page.getByRole('tab', { name: /Verification · 4 flagged/ })).toBeVisible();

  const pravoxil = page
    .locator('div', { has: page.getByText('Pravoxil', { exact: true }) })
    .filter({ hasText: 'Contradicted' })
    .first();
  await expect(pravoxil).toBeVisible();
  await expect(page.getByText(/Pranixol/).first()).toBeVisible();
  await expect(
    page.getByText(/Similar-looking monograph name\(s\) not treated as a match: Pravoxil/),
  ).toBeVisible();

  await page.getByRole('button', { name: /Pravoxil › Prescribing notes, p\.5/ }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('Quote verified in source')).toBeVisible();
  await expect(
    sheet.getByText(/take Pravoxil at bedtime, not in the morning/).first(),
  ).toBeVisible();
  await sheet.getByRole('button', { name: 'View in reference document' }).click();
  await expect(page.getByRole('dialog').getByText('5 / 10')).toBeVisible();
});

test('unauthenticated users are redirected and API is protected', async ({ page, request }) => {
  await page.goto('/documents');
  await expect(page).toHaveURL(/\/login/);
  const res = await request.get('/api/documents');
  expect(res.status()).toBe(401);
});
