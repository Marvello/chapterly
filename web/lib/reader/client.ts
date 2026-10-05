// Browser-side entry points shared by the reader views.
import { httpApi } from "./httpApi";
import { idbStore } from "./idb";
import { syncOnce, type SyncResult } from "./sync";

let running: Promise<SyncResult> | null = null;

/** One sync at a time; callers during a run get that run's result. */
export function runSync(opts?: { flushOnly?: boolean }): Promise<SyncResult> {
  running ??= (async () => {
    try {
      const r = await syncOnce(idbStore(), httpApi, opts);
      if (r.downloaded) await navigator.storage?.persist?.();   // keep downloads safe from eviction
      return r;
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Switch reader views without a server round trip (Next syncs useSearchParams with pushState). */
export const go = (href: string) => window.history.pushState(null, "", href);
