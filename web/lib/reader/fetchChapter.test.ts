import { describe, expect, it, vi } from "vitest";
import type { TocEntry } from "@/lib/db";
import { fetchChapter } from "./fetchChapter";
import { AuthError } from "./sync";
import { memoryStore } from "./testStore";

const entry = (id: number): TocEntry => ({ id, idx: id, title: `C${id}` });
const row = (id: number) => ({ ...entry(id), novelId: 1, html: `<p>${id}</p>` });
// Server order: 1, 2, 3, 4 — but chapter 2 was fetched after the phone stored its toc [1, 3, 4].
const server = [1, 2, 3, 4];
const api = () => ({
  toc: vi.fn(async () => server.map(entry)),
  chapters: vi.fn(async (_n: number, after: number | null, limit: number) =>
    server.filter(id => after === null || id > after).slice(0, limit).map(row)),
});

describe("fetchChapter", () => {
  it("uses the stored copy first", async () => {
    const { store } = memoryStore();
    await store.putChapters([row(3)]);
    const a = api();
    expect((await fetchChapter(a, store, 1, [1, 3, 4].map(entry), 3)).chapter?.id).toBe(3);
    expect(a.chapters).not.toHaveBeenCalled();
  });
  it("finds the right chapter even when the stored toc is missing one before it", async () => {
    const { store } = memoryStore();
    const r = await fetchChapter(api(), store, 1, [1, 3, 4].map(entry), 3);
    expect(r.chapter?.id).toBe(3);
    expect(await store.getChapter(3)).toBeTruthy();
  });
  it("refreshes the toc when the chapter isn't where the stored toc says", async () => {
    const { s, store } = memoryStore();
    const a = api();
    a.chapters.mockImplementationOnce(async () => []);   // first window misses
    const r = await fetchChapter(a, store, 1, [1, 3, 4].map(entry), 4);
    expect(r.chapter?.id).toBe(4);
    expect(r.toc.map(c => c.id)).toEqual([1, 2, 3, 4]);
    expect(s.tocs.get(1)?.length).toBe(4);
  });
  it("returns null when the server doesn't have it; lets AuthError through", async () => {
    const { store } = memoryStore();
    expect((await fetchChapter(api(), store, 1, [1, 3, 4].map(entry), 99)).chapter).toBeNull();
    const a = api();
    a.chapters.mockImplementation(async () => { throw new AuthError("signed out"); });
    await expect(fetchChapter(a, store, 1, [1, 3, 4].map(entry), 3)).rejects.toBeInstanceOf(AuthError);
  });
});
