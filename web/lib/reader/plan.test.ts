import { describe, expect, it } from "vitest";
import { planCache } from "./plan";
import type { Position } from "./types";

const toc = Array.from({ length: 300 }, (_, i) => ({ id: i + 1, idx: i + 1, title: null }));
const at = (chapterId: number): Position => ({ novelId: 1, chapterId, idx: chapterId, fraction: 0 });
const range = (a: number, b: number) => new Set(Array.from({ length: b - a + 1 }, (_, i) => a + i));

describe("planCache", () => {
  it("does nothing for a novel that is neither started nor pinned", () => {
    expect(planCache(toc, range(1, 5), null, false)).toEqual({ fetch: [], evict: [] });
  });
  it("reading: current chapter + 50 ahead", () => {
    expect(planCache(toc, new Set(), at(100), false).fetch).toEqual([{ after: 99, count: 51 }]);
  });
  it("only fetches the gaps", () => {
    expect(planCache(toc, range(110, 119), at(100), false).fetch)
      .toEqual([{ after: 99, count: 10 }, { after: 119, count: 31 }]);
  });
  it("evicts more than 20 chapters behind the current one", () => {
    expect(planCache(toc, range(1, 100), at(100), false).evict).toEqual([...range(1, 79)]);
  });
  it("pinned and not started: every chapter, in batches of 200", () => {
    expect(planCache(toc, new Set(), null, true).fetch).toEqual([{ after: null, count: 200 }, { after: 200, count: 100 }]);
  });
  it("pinned and started: every chapter from the current one", () => {
    expect(planCache(toc, new Set(), at(100), true).fetch).toEqual([{ after: 99, count: 200 }, { after: 299, count: 1 }]);
  });
  it("a progress chapter missing from the toc counts as the start", () => {
    expect(planCache(toc, new Set(), at(999), false).fetch).toEqual([{ after: null, count: 51 }]);
  });
});
