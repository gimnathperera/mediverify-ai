import '@testing-library/jest-dom/vitest';

// Vitest runs without globals, so Testing Library cannot register its own afterEach cleanup.
// eslint-disable-next-line testing-library/no-manual-cleanup
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';

import { FakeEventSource } from './fake-event-source';
import { server } from './msw';

// jsdom has no EventSource; tests drive SSE through FakeEventSource.instances.
vi.stubGlobal('EventSource', FakeEventSource);
// Radix and the layout code use these browser APIs that jsdom lacks.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
window.HTMLElement.prototype.scrollIntoView = vi.fn();
// react-hot-toast reads prefers-reduced-motion.
window.matchMedia = (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  addListener: () => undefined,
  removeListener: () => undefined,
  dispatchEvent: () => false,
});
window.scrollTo = vi.fn();

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
  // The app calls same-origin relative URLs (`/api/...`); Node's fetch needs absolute ones.
  // Wrap MSW's patched fetch so requests resolve against the jsdom page origin.
  const mswFetch = globalThis.fetch;
  globalThis.fetch = (input, init) =>
    mswFetch(
      typeof input === 'string' && input.startsWith('/')
        ? new URL(input, window.location.origin)
        : input,
      init,
    );
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  FakeEventSource.instances.length = 0;
  document.title = '';
});
afterAll(() => server.close());
