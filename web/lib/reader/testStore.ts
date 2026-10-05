// In-memory ReaderStore for tests (IndexedDB isn't available under vitest's node environment).
import type { ReaderNovel, TocEntry } from "@/lib/db";
import { mergeOutbox } from "./progress";
import type { ReaderStore } from "./sync";
import type { OutboxEntry, StoredChapter } from "./types";

export function memoryStore() {
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
