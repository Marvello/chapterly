import { describe, expect, it, vi, type Mock } from "vitest";
import type { LibraryRow, ReaderChapterRow, ReaderNovel } from "@/lib/db";
import { CLEAN_VERSION } from "@/lib/cleanVersion";
import { chapters, libraryRows, parseProgress, putProgress, toc, type ReaderDb } from "./api";

const ORIGIN = "https://chapterly.example";
const NOW = Date.parse("2026-10-05T00:00:00Z");
const row = (id: number, clean: number, html = `<p>${id}</p>`): ReaderChapterRow =>
  ({ id, novel_id: 3, idx: id, title: `C${id}`, html, html_clean: clean });

type FakeDb = { [K in keyof ReaderDb]: Mock<ReaderDb[K]> };

function fakeDb(rows: ReaderChapterRow[] = []): FakeDb {
  return {
    getNovel: vi.fn((id: number) => (id === 3 ? { id: 3 } : undefined)),
    readerLibrary: vi.fn(() => []),
    readerToc: vi.fn(() => [{ id: 1, idx: 1, title: "C1" }]),
    readerChapters: vi.fn(() => rows),
    saveCleanHtml: vi.fn(),
    saveProgress: vi.fn(() => ({ saved: true, position: null })),
  } as unknown as FakeDb;
}
const headers = (h: Record<string, string> = {}) =>
  new Headers({ "content-type": "application/json", origin: ORIGIN, ...h });
const body = (o: Record<string, unknown> = {}) =>
  JSON.stringify({ novelId: 3, chapterId: 7, fraction: 0.5, readAt: "2026-10-04T23:00:00.000Z", ...o });

describe("toc", () => {
  it("404 for an unknown or malformed novel id", () => {
    expect(toc(fakeDb(), "9").status).toBe(404);
    expect(toc(fakeDb(), "abc").status).toBe(404);
  });
  it("returns the chapter list", () => {
    expect(toc(fakeDb(), "3")).toEqual({ status: 200, body: [{ id: 1, idx: 1, title: "C1" }] });
  });
});

describe("chapters", () => {
  const clean = (h: string) => h.replace(/<script>.*?<\/script>/g, "");
  it("400 on a bad cursor or limit", () => {
    const p = (q: string) => chapters(fakeDb(), clean, "3", new URLSearchParams(q)).status;
    expect(p("after=x")).toBe(400);
    expect(p("limit=0")).toBe(400);
    expect(p("limit=2.5")).toBe(400);
  });
  it("defaults to 50 and caps at 200", () => {
    const db = fakeDb();
    chapters(db, clean, "3", new URLSearchParams(""));
    chapters(db, clean, "3", new URLSearchParams("after=5&limit=1000"));
    expect(db.readerChapters.mock.calls).toEqual([[3, null, 50], [3, 5, 200]]);
  });
  it("re-cleans and writes back rows cleaned under older rules; leaves current rows alone", () => {
    const db = fakeDb([row(1, CLEAN_VERSION), row(2, CLEAN_VERSION - 1, "<p>2</p><script>x</script>")]);
    const r = chapters(db, clean, "3", new URLSearchParams(""));
    expect(r.body).toEqual([
      { id: 1, novelId: 3, idx: 1, title: "C1", html: "<p>1</p>" },
      { id: 2, novelId: 3, idx: 2, title: "C2", html: "<p>2</p>" },
    ]);
    expect(db.saveCleanHtml.mock.calls).toEqual([[2, "<p>2</p>", CLEAN_VERSION]]);
  });
  it("omits a row whose cleaning throws, and logs it", () => {
    const log = vi.fn();
    const r = chapters(fakeDb([row(1, 0), row(2, CLEAN_VERSION)]), () => { throw new Error("boom"); }, "3", new URLSearchParams(""), log);
    expect((r.body as { id: number }[]).map(c => c.id)).toEqual([2]);
    expect(log).toHaveBeenCalledOnce();
  });
});

describe("parseProgress", () => {
  it("accepts a valid body and clamps fraction", () => {
    expect(parseProgress(body({ fraction: 1.7 }), NOW)).toEqual(
      { novelId: 3, chapterId: 7, fraction: 1, readAt: "2026-10-04T23:00:00.000Z", force: false });
    expect(parseProgress(body({ force: true }), NOW)?.force).toBe(true);
  });
  it("rejects bad json, ids, fraction, readAt, force", () => {
    for (const b of ["{", "null", body({ novelId: "x" }), body({ chapterId: 1.5 }), body({ fraction: "a" }),
      body({ readAt: "nope" }), body({ readAt: "2026-10-05T00:06:00Z" }), body({ force: "yes" })]) {
      expect(parseProgress(b, NOW)).toBeNull();
    }
  });
});

describe("putProgress", () => {
  it("403 without a JSON content type or from another origin", () => {
    expect(putProgress(fakeDb(), 1, headers({ "content-type": "text/plain" }), body(), ORIGIN, NOW).status).toBe(403);
    expect(putProgress(fakeDb(), 1, headers({ origin: "https://evil.example" }), body(), ORIGIN, NOW).status).toBe(403);
    expect(putProgress(fakeDb(), 1, new Headers({ "content-type": "application/json" }), body(), ORIGIN, NOW).status).toBe(403);
  });
  it("400 on an invalid body or a chapter from another novel", () => {
    expect(putProgress(fakeDb(), 1, headers(), "{", ORIGIN, NOW).status).toBe(400);
    const db = fakeDb();
    db.saveProgress.mockImplementation(() => { throw new Error("chapter 7 is not in novel 3"); });
    expect(putProgress(db, 1, headers(), body(), ORIGIN, NOW).status).toBe(400);
  });
  it("saves for the signed-in user", () => {
    const db = fakeDb();
    expect(putProgress(db, 42, headers(), body(), ORIGIN, NOW)).toEqual({ status: 200, body: { saved: true, position: null } });
    expect(db.saveProgress).toHaveBeenCalledWith(42,
      { novelId: 3, chapterId: 7, fraction: 0.5, readAt: "2026-10-04T23:00:00.000Z", force: false });
  });
});

describe("libraryRows", () => {
  it("adds reading progress to each library row; unread only once the novel is started", () => {
    const list = [{ id: 1, title: "A" }, { id: 2, title: "B" }] as LibraryRow[];
    const reading = [
      { id: 1, unread: 4, progress_chapter_id: 9, progress_idx: 9, progress_fraction: 0.5, read_at: "2026-10-05T00:00:00Z" },
      { id: 2, unread: 7, progress_chapter_id: null, progress_idx: null, progress_fraction: null, read_at: null },
    ] as ReaderNovel[];
    expect(libraryRows(list, reading)).toEqual([
      { id: 1, title: "A", unread: 4, progress_chapter_id: 9, progress_idx: 9, progress_fraction: 0.5, read_at: "2026-10-05T00:00:00Z" },
      { id: 2, title: "B", unread: null, progress_chapter_id: null, progress_idx: null, progress_fraction: null, read_at: null },
    ]);
  });
});
