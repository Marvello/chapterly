import { describe, expect, it } from "vitest";
import type { LibraryRow } from "./db";
import { newSince, novelStatus, relativeTime, sortLibrary } from "./view";

const row = (o: Partial<LibraryRow>): LibraryRow => ({
  id: 1, toc_url: "https://x.com/n", parser: null, title: "T", author: null, language: null, subjects: null,
  description: null, cover_url: null, status: "active", check_interval_min: 1440, last_checked_at: null,
  last_success_at: null, last_error: null, epub_path: null, epub_built_at: null, created_at: "",
  check_requested_at: null, check_finished_at: null,
  chapters_total: 0, chapters_fetched: 0, chapters_failing: 0, chapters_new: 0, ...o,
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
