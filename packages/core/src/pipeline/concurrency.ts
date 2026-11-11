/**
 * Map over `items` with at most `limit` calls in flight, returning results in input order.
 * The first rejection rejects the whole call (remaining in-flight calls are allowed to settle).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  /** When aborted, no further items are started (in-flight ones finish or abort themselves). */
  signal?: AbortSignal,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      if (signal?.aborted) throw signal.reason ?? new Error('aborted');
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}
