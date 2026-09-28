import { describe, expect, it } from "vitest";
import { INTERVALS, parseId, parseInterval, parseNovelUrl } from "./validate";

describe("parseNovelUrl", () => {
  it("normalizes whitespace and host case so the same novel isn't added twice", () => {
    expect(parseNovelUrl("  HTTPS://FreeWebNovel.com/novel/shadow-slave ")).toEqual({ ok: true, url: "https://freewebnovel.com/novel/shadow-slave" });
  });
  it("rejects non-http(s), junk, empty and oversized input", () => {
    for (const bad of ["javascript:alert(1)", "ftp://x.com/a", "not a url", "", null, `https://x.com/${"a".repeat(2100)}`]) {
      expect(parseNovelUrl(bad).ok).toBe(false);
    }
  });
});

it("parseInterval accepts only the allowed values", () => {
  expect(INTERVALS.map(i => i.minutes)).toEqual([360, 720, 1440, 4320, 10080]);
  expect(parseInterval("1440")).toBe(1440);
  expect(parseInterval("60")).toBeNull();
  expect(parseInterval("abc")).toBeNull();
});

it("parseId accepts positive integers only", () => {
  expect(parseId("12")).toBe(12);
  for (const bad of ["0", "-1", "1.5", "1e3", "", null, "12abc"]) expect(parseId(bad)).toBeNull();
});
