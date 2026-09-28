import { describe, expect, it } from "vitest";
import { INTERVALS, checkSupportedSite, parseId, parseInterval, parseNovelUrl, parseSeriesStatus } from "./validate";

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

describe("checkSupportedSite", () => {
  const list = new Set(["freewebnovel.com", "royalroad.com"]);
  const lookup = (host: string) => list.has(host.replace(/^www\./, ""));
  it("accepts hosts with a dedicated WebToEpub parser", () => {
    expect(checkSupportedSite("https://freewebnovel.com/novel/x", lookup)).toBeNull();
    expect(checkSupportedSite("https://www.royalroad.com/fiction/1", lookup)).toBeNull();
  });
  it("rejects other sites with a clear message", () => {
    expect(checkSupportedSite("https://example.com/", lookup)).toBe("example.com isn't a supported site (no WebToEpub parser).");
  });
  it("doesn't block while the worker hasn't published the list yet", () => {
    expect(checkSupportedSite("https://example.com/", () => null)).toBeNull();
  });
});

it("parseSeriesStatus accepts only ongoing / completed / dropped", () => {
  expect(["ongoing", "completed", "dropped"].map(parseSeriesStatus)).toEqual(["ongoing", "completed", "dropped"]);
  for (const bad of ["paused", "", null, "Completed"]) expect(parseSeriesStatus(bad)).toBeNull();
});
