import { afterEach, expect, it, vi } from "vitest";
import { online, unreachable } from "./online";

afterEach(() => { vi.unstubAllGlobals(); online.setReachable(true); });

it("online only when the device has a network AND the server answered the last sync", () => {
  vi.stubGlobal("navigator", { onLine: true });
  expect(online.get()).toBe(true);
  let calls = 0;
  const off = online.subscribe(() => { calls++; });
  online.setReachable(false);                       // e.g. tower or the tunnel is down
  expect([online.get(), calls]).toEqual([false, 1]);
  online.setReachable(true);
  expect(online.get()).toBe(true);
  vi.stubGlobal("navigator", { onLine: false });
  expect(online.get()).toBe(false);
  off();
});

it("network errors, timeouts and gateway errors mean unreachable; other server errors don't", () => {
  expect(unreachable(new TypeError("Failed to fetch"))).toBe(true);
  expect(unreachable(new DOMException("timed out", "TimeoutError"))).toBe(true);
  for (const s of [502, 503, 504, 530]) expect(unreachable(new Error(`/api/reader/library: HTTP ${s}`))).toBe(true);
  expect(unreachable(new Error("/api/reader/library: HTTP 500"))).toBe(false);
  expect(unreachable(new Error("/api/reader/progress: HTTP 403"))).toBe(false);
});
