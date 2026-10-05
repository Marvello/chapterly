// IndexedDB for the reader (browser only). Stores: chapters (key id, index [novelId, idx]),
// tocs / library / outbox / pins (out-of-line keys).
import type { ReaderNovel, TocEntry } from "@/lib/db";
import { mergeOutbox } from "./progress";
import type { ReaderStore } from "./sync";
import type { OutboxEntry, StoredChapter } from "./types";

type StoreName = "chapters" | "tocs" | "library" | "outbox" | "pins";
let opened: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  return opened ??= new Promise((resolve, reject) => {
    const req = indexedDB.open("chapterly-reader", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("chapters", { keyPath: "id" }).createIndex("novel", ["novelId", "idx"]);
      for (const s of ["tocs", "library", "outbox", "pins"]) db.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
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
    async queue(e) { await put("outbox", mergeOutbox(await get<OutboxEntry>("outbox", e.novelId), e), e.novelId); },
    async clearOutbox(id, readAt) { if ((await get<OutboxEntry>("outbox", id))?.readAt === readAt) await del("outbox", id); },
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
