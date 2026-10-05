import { describe, expect, it } from "vitest";
import { INTERVALS, checkSupportedSite, parseId, parseInterval, parseNovelUrl, parseSeriesStatus, readCapped } from "./validate";

describe("parseNovelUrl", () => {
  it("normalizes whitespace and host case so the same novel isn't added twice", () => {
    expect(parseNovelUrl("  HTTPS://FreeWebNovel.com/novel/shadow-slave ")).toEqual({ ok: true, url: "https://freewebnovel.com/novel/shadow-slave" });
  });
  it("drops the #fragment and user:pass@ credentials", () => {
    expect(parseNovelUrl("https://me:secret@freewebnovel.com/novel/x#chapter-3")).toEqual({ ok: true, url: "https://freewebnovel.com/novel/x" });
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
  it("refuses with a clear message while the worker hasn't published the list yet", () => {
    expect(checkSupportedSite("https://freewebnovel.com/novel/x", () => null)).toMatch(/worker hasn't started/);
  });
});

it("parseSeriesStatus accepts only ongoing / completed / dropped", () => {
  expect(["ongoing", "completed", "dropped"].map(parseSeriesStatus)).toEqual(["ongoing", "completed", "dropped"]);
  for (const bad of ["paused", "", null, "Completed"]) expect(parseSeriesStatus(bad)).toBeNull();
});

describe("readCapped", () => {
  const put = (body: string, headers: Record<string, string> = {}) =>
    new Request("http://x/", { method: "PUT", body, headers });
  it("returns the body up to the cap", async () => {
    expect(await readCapped(put("hello"), 5)).toBe("hello");
  });
  it("refuses a body over the cap, by content-length or by bytes read", async () => {
    expect(await readCapped(put("hello", { "content-length": "9999" }), 5)).toBeNull();
    expect(await readCapped(put("hello!"), 5)).toBeNull();
  });
});
