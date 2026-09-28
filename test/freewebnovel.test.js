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

    console.log("✓ freewebnovel harness test passed");
    console.log({ ...novel, _parser: undefined, chapters: novel.chapters.length });
    console.log(ch.html);
})().catch(e => { console.error("✗", e); process.exit(1); });
