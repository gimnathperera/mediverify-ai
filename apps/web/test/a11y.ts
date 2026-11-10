import axe from 'axe-core';
import { expect } from 'vitest';

/**
 * Run axe-core on a rendered subtree and fail with a readable list of violations.
 * Colour contrast needs real layout and fonts, so it is checked in Playwright (tests/e2e), not jsdom.
 */
export async function expectNoA11yViolations(container: Element) {
  const result = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  const summary = result.violations.map(
    (v) => `${v.id} (${v.impact ?? 'n/a'}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
  expect(summary).toEqual([]);
}
