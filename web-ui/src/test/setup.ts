// Runs before every test file. jsdom is a browser without layout or networking, so a few APIs the page uses
// are filled in here with small fakes.
import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  FakeEventSource.instances = [];
});

// window.matchMedia: report "wide screen" unless a test changes `matchMediaWide`.
(globalThis as { matchMediaWide?: boolean }).matchMediaWide = true;
window.matchMedia = vi.fn((query: string) => ({
  matches: (globalThis as { matchMediaWide?: boolean }).matchMediaWide === true && query.includes("min-width"),
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

// EventSource: tests push snapshots with FakeEventSource.last().push(snapshot).
export class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static CLOSED = 2;
  readyState = 1;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
  constructor(public url: string) { FakeEventSource.instances.push(this); }
  addEventListener(type: string, fn: (e: MessageEvent) => void) { (this.listeners[type] ??= []).push(fn); }
  close() { this.readyState = 2; }
  push(data: unknown) { for (const fn of this.listeners.snapshot ?? []) fn(new MessageEvent("snapshot", { data: JSON.stringify(data) })); }
  static last() { return FakeEventSource.instances[FakeEventSource.instances.length - 1]; }
}
(globalThis as unknown as { EventSource: typeof FakeEventSource }).EventSource = FakeEventSource;

// fetch (POST /api/refresh): record calls instead of sending them. (The clipboard is user-event's own fake:
// tests read it back with navigator.clipboard.readText().)
globalThis.fetch = vi.fn(() => Promise.resolve(new Response("{}", { status: 202 }))) as unknown as typeof fetch;
