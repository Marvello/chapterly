import { describe, expect, it, vi } from "vitest";
import type { ReaderNovel, ReaderPosition, TocEntry } from "@/lib/db";
import { mergeOutbox } from "./progress";
import { AuthError, BadRequestError, syncOnce, type ReaderApi, type ReaderStore } from "./sync";
import type { OutboxEntry, StoredChapter } from "./types";

function memoryStore() {
  const s = {
    library: undefined as ReaderNovel[] | undefined, tocs: new Map<number, TocEntry[]>(),
    chapters: new Map<number, StoredChapter>(), outbox: new Map<number, OutboxEntry>(), pins: new Set<number>(),
  };
  const store: ReaderStore = {
    getLibrary: async () => s.library,
    setLibrary: async l => { s.library = l; },
    applyPosition: async p => {
      s.library = s.library?.map(n => n.id === p.novelId ? { ...n, progress_chapter_id: p.chapterId, progress_idx: p.idx,
        progress_fraction: p.fraction, read_at: p.readAt } : n);
    },
    getToc: async id => s.tocs.get(id),
    setToc: async (id, t) => { s.tocs.set(id, t); },
    cachedChapterIds: async id => new Set([...s.chapters.values()].filter(c => c.novelId === id).map(c => c.id)),
    getChapter: async id => s.chapters.get(id),
    putChapters: async list => { for (const c of list) s.chapters.set(c.id, c); },
    deleteChapters: async ids => { for (const id of ids) s.chapters.delete(id); },
    outbox: async () => [...s.outbox.values()],
    getOutbox: async id => s.outbox.get(id),
    queue: async e => { s.outbox.set(e.novelId, mergeOutbox(s.outbox.get(e.novelId), e)); },
    clearOutbox: async (id, readAt) => { if (s.outbox.get(id)?.readAt === readAt) s.outbox.delete(id); },
    pins: async () => new Set(s.pins),
    setPin: async (id, on) => { if (on) s.pins.add(id); else s.pins.delete(id); },
    deleteNovel: async id => {
      for (const c of [...s.chapters.values()]) if (c.novelId === id) s.chapters.delete(c.id);
      s.tocs.delete(id); s.outbox.delete(id); s.pins.delete(id);
    },
  };
  return { s, store };
}

const novel = (id: number, o: Partial<ReaderNovel> = {}): ReaderNovel => ({ id, title: `N${id}`, author: null,
  cover_url: null, toc_url: "", chapters_fetched: 3, unread: 3, progress_chapter_id: null, progress_idx: null,
  progress_fraction: null, read_at: null, ...o });
const TOC: TocEntry[] = [1, 2, 3].map(i => ({ id: i, idx: i, title: `C${i}` }));
const entry = (o: Partial<OutboxEntry> = {}): OutboxEntry =>
  ({ novelId: 1, chapterId: 2, idx: 2, fraction: 0.5, readAt: "2026-10-05T00:00:00.000Z", force: false, ...o });
const position = (o: Partial<ReaderPosition> = {}): ReaderPosition =>
  ({ novelId: 1, chapterId: 3, idx: 3, fraction: 0.1, readAt: "2026-10-05T01:00:00.000Z", ...o });

function fakeApi(o: Partial<ReaderApi> = {}): ReaderApi {
  return {
    library: vi.fn(async () => [novel(1, { progress_chapter_id: 1, progress_idx: 1, progress_fraction: 0 })]),
    toc: vi.fn(async () => TOC),
    chapters: vi.fn(async (novelId: number, after: number | null, limit: number) =>
      TOC.filter(c => after === null || c.id > after).slice(0, limit).map(c => ({ ...c, novelId, html: `<p>${c.id}</p>` }))),
    putProgress: vi.fn(async () => ({ saved: true, position: position() })),
    ...o,
  };
}

describe("syncOnce", () => {
  it("flushes the outbox and applies the server's position", async () => {
    const { s, store } = memoryStore();
    s.library = [novel(1)];
    await store.queue(entry());
    const api = fakeApi({ library: vi.fn(async () => { throw new Error("stop after flush"); }) });
    await expect(syncOnce(store, api)).rejects.toThrow("stop after flush");
    expect(s.outbox.size).toBe(0);
    expect(s.library?.[0].progress_chapter_id).toBe(3);
  });

  it("keeps an entry queued during the flush", async () => {
    const { s, store } = memoryStore();
    await store.queue(entry());
    const api = fakeApi({ putProgress: vi.fn(async () => {
      await store.queue(entry({ chapterId: 3, idx: 3, readAt: "2026-10-05T00:00:09.000Z" }));
      return { saved: true, position: null };
    }) });
    await syncOnce(store, api, { flushOnly: true });
    expect(s.outbox.get(1)).toMatchObject({ chapterId: 3 });
  });

  it("400 drops the entry and carries on", async () => {
    const { s, store } = memoryStore();
    await store.queue(entry());
    const api = fakeApi({ putProgress: vi.fn(async () => { throw new BadRequestError("bad progress"); }) });
    await syncOnce(store, api);
    expect(s.outbox.size).toBe(0);
    expect(api.library).toHaveBeenCalled();
  });

  it("401 rejects with AuthError and keeps the outbox", async () => {
    const { s, store } = memoryStore();
    await store.queue(entry());
    const api = fakeApi({ putProgress: vi.fn(async () => { throw new AuthError("signed out"); }) });
    await expect(syncOnce(store, api)).rejects.toBeInstanceOf(AuthError);
    expect(s.outbox.size).toBe(1);
  });

  it("downloads what the plan asks for and forgets novels deleted on the server", async () => {
    const { s, store } = memoryStore();
    s.library = [novel(1), novel(9)];
    await store.putChapters([{ id: 90, novelId: 9, idx: 1, title: null, html: "" }]);
    await store.setPin(9, true);
    const r = await syncOnce(store, fakeApi());
    expect(r).toEqual({ downloaded: 3, quotaExceeded: false });
    expect([...s.chapters.keys()].sort()).toEqual([1, 2, 3]);
    expect(s.pins.size).toBe(0);
    expect(s.library?.map(n => n.id)).toEqual([1]);
  });

  it("stops and reports when storage is full", async () => {
    const { store } = memoryStore();
    store.putChapters = async () => { throw new DOMException("full", "QuotaExceededError"); };
    expect(await syncOnce(store, fakeApi())).toEqual({ downloaded: 0, quotaExceeded: true });
  });
});
