// One sync pass: send unsent progress, refresh the library, keep the planned chapters on the phone.
import type { ReaderNovel, ReaderPosition, TocEntry } from "@/lib/db";
import { planCache } from "./plan";
import { savedFromLibrary } from "./progress";
import type { OutboxEntry, StoredChapter } from "./types";

export class AuthError extends Error {}
export class BadRequestError extends Error {}

export interface ReaderApi {
  library(): Promise<ReaderNovel[]>;
  toc(novelId: number): Promise<TocEntry[]>;
  chapters(novelId: number, after: number | null, limit: number): Promise<StoredChapter[]>;
  putProgress(e: OutboxEntry): Promise<{ saved: boolean; position: ReaderPosition | null }>;
}

export interface ReaderStore {
  getLibrary(): Promise<ReaderNovel[] | undefined>;
  setLibrary(lib: ReaderNovel[]): Promise<void>;
  applyPosition(p: ReaderPosition): Promise<void>;
  getToc(novelId: number): Promise<TocEntry[] | undefined>;
  setToc(novelId: number, toc: TocEntry[]): Promise<void>;
  cachedChapterIds(novelId: number): Promise<Set<number>>;
  getChapter(id: number): Promise<StoredChapter | undefined>;
  putChapters(list: StoredChapter[]): Promise<void>;
  deleteChapters(ids: number[]): Promise<void>;
  outbox(): Promise<OutboxEntry[]>;
  getOutbox(novelId: number): Promise<OutboxEntry | undefined>;
  /** Merges with any unsent entry for the same novel (keeps force). */
  queue(e: OutboxEntry): Promise<void>;
  /** Deletes the entry only if it is still the one sent (same readAt). */
  clearOutbox(novelId: number, readAt: string): Promise<void>;
  pins(): Promise<Set<number>>;
  setPin(novelId: number, on: boolean): Promise<void>;
  /** Chapters, toc, outbox entry and pin. */
  deleteNovel(novelId: number): Promise<void>;
}

export type SyncResult = { downloaded: number; quotaExceeded: boolean };

export async function syncOnce(store: ReaderStore, api: ReaderApi, opts: { flushOnly?: boolean } = {}): Promise<SyncResult> {
  for (const e of await store.outbox()) {
    try {
      const r = await api.putProgress(e);
      if (r.position) await store.applyPosition(r.position);
    } catch (err) {
      if (!(err instanceof BadRequestError)) throw err;   // 400 never gets better (e.g. a wrong phone clock): drop it
    }
    await store.clearOutbox(e.novelId, e.readAt);
  }
  if (opts.flushOnly) return { downloaded: 0, quotaExceeded: false };

  const lib = await api.library();
  const ids = new Set(lib.map(n => n.id));
  for (const n of (await store.getLibrary()) ?? []) if (!ids.has(n.id)) await store.deleteNovel(n.id);
  for (const id of await store.pins()) if (!ids.has(id)) await store.deleteNovel(id);
  await store.setLibrary(lib);

  const pins = await store.pins();
  let downloaded = 0;
  try {
    for (const n of lib) {
      const progress = savedFromLibrary(n), pinned = pins.has(n.id);
      if (!progress && !pinned) continue;
      const toc = await api.toc(n.id);
      await store.setToc(n.id, toc);
      const plan = planCache(toc, await store.cachedChapterIds(n.id), progress, pinned);
      if (plan.evict.length) await store.deleteChapters(plan.evict);
      for (const f of plan.fetch) {
        const rows = await api.chapters(n.id, f.after, f.count);
        await store.putChapters(rows);
        downloaded += rows.length;
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "QuotaExceededError") return { downloaded, quotaExceeded: true };
    throw err;
  }
  return { downloaded, quotaExceeded: false };
}
