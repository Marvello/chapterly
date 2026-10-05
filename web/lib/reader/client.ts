// Browser-side entry points shared by the reader views.
import { httpApi } from "./httpApi";
import { idbStore } from "./idb";
import { syncOnce, type SyncResult } from "./sync";

let running: Promise<SyncResult> | null = null;
let queued: { full: boolean; run: Promise<SyncResult> } | null = null;

async function once(full: boolean) {
  const r = await syncOnce(idbStore(), httpApi, { flushOnly: !full });
  if (r.downloaded) await navigator.storage?.persist?.();   // keep downloads safe from eviction
  return r;
}

/** One sync at a time. Calls during a run share one follow-up run (full if any of them asked for full),
 * so each caller's result covers what it asked for and everything queued before it. */
export function runSync(opts?: { flushOnly?: boolean }): Promise<SyncResult> {
  const full = !opts?.flushOnly;
  if (!running) {
    running = once(full).finally(() => { running = null; });
    return running;
  }
  if (queued) {
    queued.full ||= full;
    return queued.run;
  }
  queued = { full, run: running.catch(() => {}).then(() => {
    const flushOnly = !queued!.full;
    queued = null;
    return runSync({ flushOnly });
  }) };
  return queued.run;
}

/** Switch reader views without a server round trip (Next syncs useSearchParams with pushState). */
export const go = (href: string) => window.history.pushState(null, "", href);
