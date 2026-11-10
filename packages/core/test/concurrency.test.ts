import { describe, expect, it } from 'vitest';

import { mapWithConcurrency } from '../src/pipeline/concurrency.js';

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('mapWithConcurrency', () => {
  it('keeps input order and never exceeds the limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapWithConcurrency([30, 5, 20, 1, 10, 2], 3, async (ms, i) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await tick(ms);
      inFlight--;
      return i;
    });
    expect(out).toEqual([0, 1, 2, 3, 4, 5]);
    expect(peak).toBe(3);
  });

  it('rejects when any call fails, and handles empty input', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, (n) =>
        n === 2 ? Promise.reject(new Error('boom')) : Promise.resolve(n),
      ),
    ).rejects.toThrow('boom');
    expect(await mapWithConcurrency([], 3, () => Promise.resolve(1))).toEqual([]);
  });
});
