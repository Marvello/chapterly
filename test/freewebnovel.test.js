// Offline test: runs WebToEpub's real FreeWebNovelComParser over the synthetic site in mockSite.js.
"use strict";
const assert = require("assert");
const { createScraper } = require("../src/scraper");
const { mockSite, BASE } = require("./mockSite");

(async () => {
    const s = createScraper({ fetch: mockSite().fetch });
    assert.deepStrictEqual(s.loadFailures, [], "all WebToEpub files should load");
    assert.strictEqual(s.parserNameFor(BASE), "FreeWebNovelComParser");

    const novel = await s.getNovel(BASE);
    assert.strictEqual(novel.parser, "FreeWebNovelComParser");
    assert.strictEqual(novel.title, "Test Story");
    assert.strictEqual(novel.author, "Jane Placeholder");
    assert.strictEqual(novel.subjects, "Fantasy, Adventure");
    assert.strictEqual(novel.cover, "https://freewebnovel.com/files/cover.jpg");
    assert.strictEqual(novel.chapters.length, 5, "should merge paginated TOC");
    assert.strictEqual(novel.chapters[4].url, `${BASE}/chapter-5`);

    const ch = await s.getChapter(novel, novel.chapters[0].url, { throttle: false });
    assert.strictEqual(ch.title, "Chapter 1: Placeholder Title");
    assert.ok(ch.text.includes("Synthetic paragraph one of chapter 1."));
    assert.ok(!ch.text.includes("AD CONTENT"), "ad div removed");
    assert.ok(!ch.text.includes("originates from"), "watermark removed");
    assert.ok(!ch.text.includes("junk"), "<sub> junk removed");
    assert.ok(!ch.html.includes("<script"), "scripts removed");

    // Sites without a dedicated parser use WebToEpub's DefaultParser, whose settings class lives in
    // DefaultParserUI.js; it must load headless (regression: "DefaultParserSiteSettings is not defined").
    const generic = "https://unknown-site.example/story";
    const genericPage = `<html><head><title>Generic Story</title></head><body>
      <a href="${generic}/1">Chapter 1</a><a href="${generic}/2">Chapter 2</a></body></html>`;
    const s2 = createScraper({ fetch: async url => {
        const res = new Response(String(url) === generic ? genericPage : "not found",
            { status: String(url) === generic ? 200 : 404, headers: { "content-type": "text/html" } });
        Object.defineProperty(res, "url", { value: String(url) });
        return res;
    } });
    const g = await s2.getNovel(generic);
    assert.strictEqual(g.usingDefaultParser, true);
    assert.strictEqual(g.title, "Generic Story");

    console.log("✓ freewebnovel harness test passed");
    console.log({ ...novel, _parser: undefined, chapters: novel.chapters.length });
    console.log(ch.html);
})().catch(e => { console.error("✗", e); process.exit(1); });
