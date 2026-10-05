import { expect, it, vi } from "vitest";
import { runSync } from "./client";
import { syncOnce, type SyncResult } from "./sync";

vi.mock("./idb", () => ({ idbStore: () => ({}) }));
vi.mock("./sync", () => ({ syncOnce: vi.fn() }));

it("calls during a run get one follow-up run, full if any of them asked for full", async () => {
  const runs: { flushOnly?: boolean; finish: (r: SyncResult) => void }[] = [];
  vi.mocked(syncOnce).mockImplementation((_s, _a, opts) =>
    new Promise(finish => runs.push({ flushOnly: opts?.flushOnly, finish })));
  const result = (n: number): SyncResult => ({ downloaded: 0, quotaExceeded: false, progressError: `run ${n}` });

  const first = runSync({ flushOnly: true });
  const full = runSync();
  const flush = runSync({ flushOnly: true });
  expect(flush).toBe(full);
  expect(runs).toHaveLength(1);

  runs[0].finish(result(1));
  expect(await first).toEqual(result(1));
  await vi.waitFor(() => expect(runs).toHaveLength(2));
  expect(runs[1].flushOnly).toBe(false);
  runs[1].finish(result(2));
  expect(await full).toEqual(result(2));
  expect(runs).toHaveLength(2);
});
