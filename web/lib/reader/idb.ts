// IndexedDB for the reader (browser only). Stores: chapters (key id, index [novelId, idx]),
// tocs / library / outbox / pins (out-of-line keys).
import { CLEAN_VERSION } from "@/lib/cleanVersion";
import type { ReaderNovel, TocEntry } from "@/lib/db";
import { mergeOutbox } from "./progress";
import type { ReaderStore } from "./sync";
import type { OutboxEntry, StoredChapter } from "./types";

type StoreName = "chapters" | "tocs" | "library" | "outbox" | "pins";
const DB = "chapterly-reader";
let opened: Promise<IDBDatabase> | null = null;

/** The database needs upgrading but another tab/window (or the installed app) still has the old version open. */
export class IdbBlockedError extends Error {}

function open(): Promise<IDBDatabase> {
  return opened ??= new Promise((resolve, reject) => {
    // Version follows CLEAN_VERSION: new cleaning rules drop the phone's chapters so sync downloads them
    // cleaned again. (Store layout unchanged since v1; a layout change needs its own step here.)
    const req = indexedDB.open(DB, CLEAN_VERSION);
    let blocked = false;
    req.onupgradeneeded = e => {
      const db = req.result;
      if (e.oldVersion === 0) {
        db.createObjectStore("chapters", { keyPath: "id" }).createIndex("novel", ["novelId", "idx"]);
        for (const s of ["tocs", "library", "outbox", "pins"]) db.createObjectStore(s);
      } else {
        req.transaction!.objectStore("chapters").clear();
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      if (blocked) return db.close();   // we already gave up on this request; the next call opens afresh
      // A newer version (another tab after a deploy) or sign-out's delete: let go instead of blocking it.
      db.onversionchange = () => { db.close(); opened = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    // Without this the open waits silently (blank app) until the other tab lets go.
    req.onblocked = () => {
      blocked = true;
      opened = null;
      reject(new IdbBlockedError("Chapterly was updated: close its other tabs or windows to finish."));
    };
  });
}

const done = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const complete = (t: IDBTransaction) =>
  new Promise<void>((resolve, reject) => { t.oncomplete = () => resolve(); t.onerror = t.onabort = () => reject(t.error); });
const store = async (s: StoreName, mode: IDBTransactionMode) => (await open()).transaction(s, mode).objectStore(s);

const get = async <T>(s: StoreName, key: IDBValidKey) => (await done((await store(s, "readonly")).get(key))) as T | undefined;
async function put(s: StoreName, value: unknown, key?: IDBValidKey) {
  const os = await store(s, "readwrite");
  await done(key === undefined ? os.put(value) : os.put(value, key));
}
const del = async (s: StoreName, key: IDBValidKey) => { await done((await store(s, "readwrite")).delete(key)); };
async function many(s: StoreName, fn: (os: IDBObjectStore) => void) {
  const t = (await open()).transaction(s, "readwrite");
  fn(t.objectStore(s));
  await complete(t);
}
async function chapterKeys(novelId: number) {
  const index = (await store("chapters", "readonly")).index("novel");
  return (await done(index.getAllKeys(IDBKeyRange.bound([novelId, -Infinity], [novelId, Infinity])))) as number[];
}

export function idbStore(): ReaderStore {
  return {
    getLibrary: () => get<ReaderNovel[]>("library", "library"),
    setLibrary: lib => put("library", lib, "library"),
    async applyPosition(p) {
      const lib = await get<ReaderNovel[]>("library", "library");
      if (!lib) return;
      await put("library", lib.map(n => n.id === p.novelId ? { ...n, progress_chapter_id: p.chapterId, progress_idx: p.idx,
        progress_fraction: p.fraction, read_at: p.readAt } : n), "library");
    },
    getToc: id => get<TocEntry[]>("tocs", id),
    setToc: (id, toc) => put("tocs", toc, id),
    cachedChapterIds: async id => new Set(await chapterKeys(id)),
    getChapter: id => get<StoredChapter>("chapters", id),
    putChapters: list => many("chapters", os => { for (const c of list) os.put(c); }),
    deleteChapters: ids => many("chapters", os => { for (const id of ids) os.delete(id); }),
    outbox: async () => (await done((await store("outbox", "readonly")).getAll())) as OutboxEntry[],
    getOutbox: id => get<OutboxEntry>("outbox", id),
    // Read and write in one transaction, so an entry queued in between can't be lost.
    queue: e => many("outbox", os => {
      const r = os.get(e.novelId);
      r.onsuccess = () => os.put(mergeOutbox(r.result, e), e.novelId);
    }),
    clearOutbox: (id, readAt) => many("outbox", os => {
      const r = os.get(id);
      r.onsuccess = () => { if ((r.result as OutboxEntry | undefined)?.readAt === readAt) os.delete(id); };
    }),
    pins: async () => new Set((await done((await store("pins", "readonly")).getAllKeys())) as number[]),
    setPin: (id, on) => (on ? put("pins", true, id) : del("pins", id)),
    async deleteNovel(id) {
      const keys = await chapterKeys(id);
      await many("chapters", os => { for (const k of keys) os.delete(k); });
      await del("tocs", id);
      await del("outbox", id);
      await del("pins", id);
    },
  };
}
