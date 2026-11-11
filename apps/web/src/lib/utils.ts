import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDuration(ms: number | null) {
  if (ms === null) return '';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** " · 9 model calls · 41,210 tokens · $0.0123" (cost only when the server has prices set). */
export function formatUsage(
  usage: { calls: number; promptTokens: number; completionTokens: number; costUsd: number | null },
  provider: string | null,
) {
  if (!usage.calls) return '';
  if (provider === 'fixture') return ` · ${usage.calls} fixture model calls (no tokens used)`;
  const tokens = (usage.promptTokens + usage.completionTokens).toLocaleString('en-US');
  const cost = usage.costUsd === null ? '' : ` · US$ ${usage.costUsd.toFixed(4)}`;
  return ` · ${usage.calls} model calls · ${tokens} tokens${cost}`;
}
