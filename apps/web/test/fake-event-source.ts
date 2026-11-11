import type { JobEventDto } from '@mediverify/shared/client';

/** Minimal EventSource stand-in: tests push persisted job events and observe the UI. */
export class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];

  readyState = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((msg: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, (() => void)[]>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, fn: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }

  close() {
    this.readyState = FakeEventSource.CLOSED;
  }

  // ── test controls ──
  open() {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.();
  }

  emit(e: JobEventDto) {
    this.onmessage?.({ data: JSON.stringify(e) });
  }

  end() {
    for (const fn of this.listeners.get('end') ?? []) fn();
  }

  /** The browser gave up (e.g. a non-200 response): readyState CLOSED, then onerror. */
  fail() {
    this.readyState = FakeEventSource.CLOSED;
    this.onerror?.();
  }
}
