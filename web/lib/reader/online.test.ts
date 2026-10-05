import { afterEach, expect, it, vi } from "vitest";
import { online } from "./online";

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
