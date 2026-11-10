/**
 * jsdom, but with Node's AbortController/AbortSignal kept global. jsdom replaces them, and Node's fetch
 * (which MSW intercepts) rejects jsdom's AbortSignal ("Expected signal to be an instance of AbortSignal").
 */
import { builtinEnvironments, type Environment } from 'vitest/environments';

const jsdom = builtinEnvironments.jsdom;

export default {
  name: 'jsdom-node-abort',
  transformMode: 'web',
  async setup(global: typeof globalThis, options) {
    const { AbortController, AbortSignal } = globalThis;
    const env = await jsdom.setup(global, options);
    Object.assign(global, { AbortController, AbortSignal });
    return env;
  },
} satisfies Environment;
