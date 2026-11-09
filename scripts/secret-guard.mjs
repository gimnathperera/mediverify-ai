#!/usr/bin/env node
// Pre-commit guard: block committing env files or obvious secrets. Uses gitleaks if installed.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const staged = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], {
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean);

const gitleaks = spawnSync('gitleaks', ['protect', '--staged', '--redact', '-v'], {
  stdio: 'inherit',
});
if (gitleaks.error === undefined && gitleaks.status !== 0) process.exit(gitleaks.status ?? 1);

const problems = [];
for (const f of staged) {
  if (/(^|\/)\.env($|\.)/.test(f) && !f.endsWith('.env.example'))
    problems.push(`${f}: env files must not be committed`);
  if (/\.(pdf|docx|png|jpg|onnx)$/i.test(f)) continue;
  let text = '';
  try {
    text = readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  if (/sk-(proj-)?[A-Za-z0-9_-]{20,}/.test(text))
    problems.push(`${f}: looks like an OpenAI API key`);
  if (/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))
    problems.push(`${f}: private key`);
}
if (problems.length) {
  console.error(`Secret guard blocked the commit:\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
