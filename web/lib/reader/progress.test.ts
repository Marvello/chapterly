import { describe, expect, it } from "vitest";
import type { ReaderNovel } from "@/lib/db";
import { chapterState, compare, decide, mergeOutbox, savedFromLibrary, savedProgress, sortReaderLibrary } from "./progress";
import type { OutboxEntry, Position } from "./types";

const P = (chapterId: number, idx: number, fraction = 0): Position => ({ novelId: 1, chapterId, idx, fraction });
const E = (p: Position, force = false, readAt = "2026-10-05T00:00:00.000Z"): OutboxEntry => ({ ...p, readAt, force });

describe("compare", () => {
  it("orders by idx, then chapter id, then fraction", () => {
    expect(compare(P(9, 1), P(2, 2))).toBeLessThan(0);
    expect(compare(P(3, 2), P(2, 2))).toBeGreaterThan(0);
    expect(compare(P(2, 2, 0.4), P(2, 2, 0.6))).toBeLessThan(0);
    expect(compare(P(2, 2, 0.5), P(2, 2, 0.5))).toBe(0);
  });
});

describe("savedProgress", () => {
  it("is the further of stored and pending; a forced pending entry always wins", () => {
    expect(savedProgress(null, null)).toBeNull();
    expect(savedProgress(P(1, 1), E(P(5, 5)))).toMatchObject({ chapterId: 5 });
    expect(savedProgress(P(5, 5), E(P(1, 1)))).toMatchObject({ chapterId: 5 });
    expect(savedProgress(P(5, 5), E(P(1, 1), true))).toMatchObject({ chapterId: 1 });
  });
});

describe("mergeOutbox", () => {
  it("newer entry replaces the old one but keeps force", () => {
    expect(mergeOutbox(E(P(1, 1), true), E(P(2, 2)))).toMatchObject({ chapterId: 2, force: true });
    expect(mergeOutbox(undefined, E(P(2, 2)))).toMatchObject({ chapterId: 2, force: false });
  });
});

describe("decide", () => {
  it("saves when not started or further, flags behind, ignores same", () => {
    expect(decide(P(1, 1), null)).toBe("save");
    expect(decide(P(2, 2), P(1, 1))).toBe("save");
    expect(decide(P(1, 1), P(2, 2))).toBe("behind");
    expect(decide(P(2, 2, 0.3), P(2, 2, 0.3))).toBe("same");
  });
});

describe("chapterState", () => {
  it("read before, current at, unread after the saved chapter", () => {
    const saved = P(5, 2);
    expect(chapterState({ id: 4, idx: 2, title: null }, saved)).toBe("read");
    expect(chapterState({ id: 5, idx: 2, title: null }, saved)).toBe("current");
    expect(chapterState({ id: 6, idx: 2, title: null }, saved)).toBe("unread");
    expect(chapterState({ id: 1, idx: 1, title: null }, null)).toBe("unread");
  });
});

const N = (id: number, o: Partial<ReaderNovel>): ReaderNovel => ({ id, title: `N${id}`, author: null, cover_url: null,
  toc_url: "", chapters_fetched: 10, unread: 0, progress_chapter_id: null, progress_idx: null, progress_fraction: null,
  read_at: null, ...o });

describe("savedFromLibrary / sortReaderLibrary", () => {
  it("maps library progress to a position", () => {
    expect(savedFromLibrary(N(1, {}))).toBeNull();
    expect(savedFromLibrary(N(1, { progress_chapter_id: 7, progress_idx: 3, progress_fraction: 0.2 })))
      .toEqual({ novelId: 1, chapterId: 7, idx: 3, fraction: 0.2 });
  });
  it("started novels with unread first (most recently read first), then the rest by title", () => {
    const started = { progress_chapter_id: 1, progress_idx: 1, progress_fraction: 0 };
    const list = [
      N(1, { title: "B", unread: 5 }),                                             // not started
      N(2, { ...started, unread: 3, read_at: "2026-10-01T00:00:00Z" }),
      N(3, { ...started, unread: 0, read_at: "2026-10-04T00:00:00Z", title: "A" }), // caught up
      N(4, { ...started, unread: 1, read_at: "2026-10-03T00:00:00Z" }),
    ];
    expect(sortReaderLibrary(list).map(n => n.id)).toEqual([4, 2, 3, 1]);
  });
});
