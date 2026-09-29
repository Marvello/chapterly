import { describe, expect, it } from "vitest";
import type { LibraryRow } from "./db";
import { fetchedPct, isSeriesDone, libraryView, newSince, nextCheckAt, novelStatus, parseLibraryQuery, queryLibrary, relativeTime, sortLibrary } from "./view";

const row = (o: Partial<LibraryRow>): LibraryRow => ({
  id: 1, toc_url: "https://x.com/n", parser: null, title: "T", author: null, language: null, subjects: null,
  description: null, cover_url: null, status: "active", check_interval_min: 1440, last_checked_at: null,
  last_success_at: null, last_error: null, epub_path: null, epub_built_at: null, created_at: "",
  check_requested_at: null, check_finished_at: null, series_status: "ongoing", series_status_manual: 0,
  chapters_total: 0, chapters_fetched: 0, chapters_failing: 0, chapters_new: 0, last_fetched_at: null, ...o,
});

describe("novelStatus", () => {
  it("paused wins", () => expect(novelStatus(row({ status: "paused", last_error: "x" }))).toBe("paused"));
  it("just added → fetching info", () => expect(novelStatus(row({ title: null }))).toBe("fetching_info"));
  it("first check failed (e.g. unsupported URL) → error, not stuck on fetching info", () => {
    expect(novelStatus(row({ title: null, last_checked_at: "2026-01-01T00:00:00Z", check_finished_at: "2026-01-01T00:00:05Z", last_error: "No chapters" }))).toBe("error");
  });
  it("running or requested → checking", () => {
    expect(novelStatus(row({ last_checked_at: "2026-01-02T00:00:00Z", check_finished_at: "2026-01-01T00:00:00Z" }))).toBe("checking");
    expect(novelStatus(row({ check_requested_at: "2026-01-02T00:00:00Z", check_finished_at: "2026-01-01T00:00:00Z" }))).toBe("checking");
  });
  it("error, then active", () => {
    expect(novelStatus(row({ last_error: "boom", check_finished_at: "x" }))).toBe("error");
    expect(novelStatus(row({ check_finished_at: "x" }))).toBe("active");
  });
});

it("sortLibrary: new chapters first, then title (url when no title)", () => {
  const sorted = sortLibrary([row({ id: 1, title: "zeta" }), row({ id: 2, title: null, toc_url: "https://a" }), row({ id: 3, title: "z", chapters_new: 2 })]);
  expect(sorted.map(r => r.id)).toEqual([3, 2, 1]);
});

it("relativeTime", () => {
  const now = Date.parse("2026-01-02T00:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  expect(relativeTime(null, now)).toBe("never");
  expect(relativeTime(ago(20_000), now)).toBe("just now");
  expect(relativeTime(ago(5 * 60_000), now)).toBe("5m ago");
  expect(relativeTime(ago(3 * 3_600_000), now)).toBe("3h ago");
  expect(relativeTime(ago(2 * 86_400_000), now)).toBe("2d ago");
  expect(relativeTime(new Date(now + 90 * 60_000).toISOString(), now)).toBe("in 1h");
});

it("newSince is 24 h before now", () => {
  expect(newSince(Date.parse("2026-01-02T00:00:00Z"))).toBe("2026-01-01T00:00:00.000Z");
});

it("isSeriesDone: completed and every chapter fetched", () => {
  expect(isSeriesDone(row({ series_status: "completed", chapters_total: 5, chapters_fetched: 5 }))).toBe(true);
  expect(isSeriesDone(row({ series_status: "completed", chapters_total: 5, chapters_fetched: 4 }))).toBe(false);
  expect(isSeriesDone(row({ series_status: "completed", chapters_total: 0, chapters_fetched: 0 }))).toBe(false);
  expect(isSeriesDone(row({ series_status: "ongoing", chapters_total: 5, chapters_fetched: 5 }))).toBe(false);
});

it("nextCheckAt mirrors the worker: interval after the last check, at least weekly when dropped", () => {
  const base = { last_checked_at: "2026-01-01T00:00:00.000Z", check_interval_min: 1440 };
  expect(nextCheckAt({ ...base, series_status: "ongoing" })).toBe("2026-01-02T00:00:00.000Z");
  expect(nextCheckAt({ ...base, series_status: "dropped" })).toBe("2026-01-08T00:00:00.000Z");
  expect(nextCheckAt({ ...base, series_status: "dropped", check_interval_min: 20160 })).toBe("2026-01-15T00:00:00.000Z");
  expect(nextCheckAt({ ...base, last_checked_at: null, series_status: "ongoing" })).toBeNull();
});

describe("libraryView / fetchedPct", () => {
  it("unknown or missing cookie falls back to overview", () => {
    expect(libraryView("table")).toBe("table");
    expect(libraryView("posters")).toBe("posters");
    expect(libraryView(undefined)).toBe("overview");
    expect(libraryView("grid<script>")).toBe("overview");
  });
  it("fetched share, 0 when there are no chapters yet", () => {
    expect(fetchedPct(row({ chapters_fetched: 1, chapters_total: 3 }))).toBe(33);
    expect(fetchedPct(row({ chapters_fetched: 0, chapters_total: 0 }))).toBe(0);
  });
});

describe("parseLibraryQuery / queryLibrary", () => {
  const lib = [
    row({ id: 1, title: "Beta", author: "Ann", chapters_total: 10, created_at: "2026-01-02", last_fetched_at: "2026-03-01" }),
    row({ id: 2, title: "alpha", author: "Bob", chapters_total: 50, created_at: "2026-01-03", last_fetched_at: "2026-02-01", series_status: "completed" }),
    row({ id: 3, title: "Gamma", chapters_total: 5, chapters_new: 2, created_at: "2026-01-01", last_error: "boom", check_finished_at: "x" }),
    row({ id: 4, title: "Delta", status: "paused", series_status: "dropped" }),
  ];
  const ids = (sort: string, filter = "all", q = "") => queryLibrary(lib, parseLibraryQuery({ sort, filter, q })).map(n => n.id);

  it("unknown params fall back to defaults; search is trimmed and capped", () => {
    expect(parseLibraryQuery({ sort: "hack", filter: ["new"], q: "  x  " })).toEqual({ sort: "new", filter: "all", q: "x" });
    expect(parseLibraryQuery({ sort: "toString" }).sort).toBe("new");
    expect(parseLibraryQuery({ q: "y".repeat(500) }).q).toHaveLength(100);
  });
  it("sorts", () => {
    expect(ids("new")).toEqual([3, 2, 1, 4]);
    expect(ids("title")).toEqual([2, 1, 4, 3]);
    expect(ids("updated")).toEqual([1, 2, 4, 3]);   // never fetched last, then by title
    expect(ids("added")).toEqual([2, 1, 3, 4]);
    expect(ids("chapters")).toEqual([2, 1, 3, 4]);
    expect(sortLibrary(lib).map(n => n.id)).toEqual(ids("new"));
  });
  it("filters and searches title / author, case-insensitive", () => {
    expect(ids("title", "new")).toEqual([3]);
    expect(ids("title", "completed")).toEqual([2]);
    expect(ids("title", "dropped")).toEqual([4]);
    expect(ids("title", "error")).toEqual([3]);
    expect(ids("title", "paused")).toEqual([4]);
    expect(ids("title", "all", "ALP")).toEqual([2]);
    expect(ids("title", "all", "ann")).toEqual([1]);
    expect(ids("title", "ongoing", "zzz")).toEqual([]);
  });
});
