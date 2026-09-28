// Offline end-to-end test: add → check (fetch all, build EPUB) → no-op check → new chapter →
// failed chapter: backoff, give up after max attempts, manual retry. Uses the synthetic site in mockSite.js.
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createScraper } = require("../src/scraper");
const { openDb } = require("../src/db");
const { checkNovel, isDue, nextRetryAt } = require("../src/worker");
const { mockSite, BASE } = require("./mockSite");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "novel-test-"));
process.env.NOVEL_LIBRARY = path.join(tmp, "library");

// Chapter file names inside the zip (each appears in the local header and the central directory).
const epubChapters = buf => new Set(buf.toString("latin1").match(/OEBPS\/Text\/\d{4}_[\w.-]+?\.xhtml/g));
const chapterRequests = site => site.requests.filter(u => /\/chapter-\d+$/.test(u));

(async () => {
    const site = mockSite(5);
    const db = openDb(path.join(tmp, "novel.db"));
    const s = createScraper({ fetch: site.fetch });
    const quiet = () => {};
    const id = db.addNovel(BASE).id;
    assert.strictEqual(db.addNovel(BASE).id, id, "adding the same URL twice returns the same novel");
    assert.strictEqual(db.getNovel(id).check_interval_min, 1440, "checked once a day by default");

    // 1st check: fetches all 5 chapters and writes the EPUB into <library>/<Author>/<Title>/.
    await checkNovel(db, s, db.getNovel(id), quiet);
    let n = db.getNovel(id);
    assert.strictEqual(n.title, "Test Story");
    assert.strictEqual(n.last_error, null);
    assert.strictEqual(n.epub_path, path.join(tmp, "library", "Jane Placeholder", "Test Story", "Test Story.epub"));
    assert.strictEqual(db.chapters(id).filter(c => c.html).length, 5);
    let epub = fs.readFileSync(n.epub_path);
    assert.strictEqual(epub.toString("latin1", 30, 58), "mimetypeapplication/epub+zip", "mimetype must be the first, stored entry");
    assert.strictEqual(epubChapters(epub).size, 5);
    assert.match(epub.toString("latin1"), /OEBPS\/Images\/\S+?\.jpe?g/, "cover image embedded");
    assert.deepStrictEqual(fs.readdirSync(path.dirname(n.epub_path)), ["Test Story.epub"], "no temp file left behind");

    // 2nd check, nothing new: no chapter fetches, EPUB not rebuilt.
    site.requests.length = 0;
    const builtAt = n.epub_built_at;
    await checkNovel(db, s, db.getNovel(id), quiet);
    assert.deepStrictEqual(chapterRequests(site), []);
    assert.strictEqual(db.getNovel(id).epub_built_at, builtAt);

    // Two new chapters, one of them broken: fetch only those, keep the good one, record the error.
    site.chapterCount = 7;
    const ch7 = `${BASE}/chapter-7`;
    site.broken.add(ch7);
    site.requests.length = 0;
    await checkNovel(db, s, db.getNovel(id), quiet);
    assert.deepStrictEqual(chapterRequests(site), [`${BASE}/chapter-6`, ch7]);
    n = db.getNovel(id);
    assert.match(n.last_error, /1 chapter\(s\) failed/);
    assert.strictEqual(epubChapters(fs.readFileSync(n.epub_path)).size, 6, "EPUB rebuilt with the chapter that arrived");
    let c7 = db.chapters(id).find(c => c.url === ch7);
    assert.strictEqual(c7.attempts, 1);
    const waitMin = (Date.parse(c7.retry_at) - Date.now()) / 60_000;
    assert.ok(waitMin > 59 && waitMin <= 60, `first retry ~60 min out, got ${waitMin}`);

    // Backoff: even with the site fixed, the next check doesn't retry before retry_at.
    site.broken.clear();
    site.requests.length = 0;
    await checkNovel(db, s, db.getNovel(id), quiet);
    assert.deepStrictEqual(chapterRequests(site), []);

    // Max attempts (policy shrunk for the test: 2 attempts, no wait): 2nd failure gives up.
    const fastGiveUp = { maxAttempts: 2, retryBaseMin: 0 };
    site.broken.add(ch7);
    await checkNovel(db, s, db.getNovel(id), quiet, fastGiveUp);   // retry_at (set with the 60-min base) not reached
    assert.strictEqual(db.chapters(id).find(c => c.url === ch7).attempts, 1, "still backing off");
    db.resetChapterRetries(id);
    await checkNovel(db, s, db.getNovel(id), quiet, fastGiveUp);   // attempt 1, retry now
    site.requests.length = 0;
    await checkNovel(db, s, db.getNovel(id), quiet, fastGiveUp);   // attempt 2 → give up
    assert.deepStrictEqual(chapterRequests(site), [ch7]);
    c7 = db.chapters(id).find(c => c.url === ch7);
    assert.strictEqual(c7.attempts, 2);
    assert.strictEqual(c7.retry_at, null);
    assert.match(db.getNovel(id).last_error, /1 chapter\(s\) gave up after 2 attempts/);
    site.requests.length = 0;
    await checkNovel(db, s, db.getNovel(id), quiet, fastGiveUp);
    assert.deepStrictEqual(chapterRequests(site), [], "no more attempts after giving up");
    assert.match(db.getNovel(id).last_error, /gave up/, "still reported after giving up");

    // `cli.js retry`: reset, site fixed → fetched, error cleared, same EPUB path, 7 chapters.
    site.broken.clear();
    db.resetChapterRetries(id);
    site.requests.length = 0;
    await checkNovel(db, s, db.getNovel(id), quiet);
    assert.deepStrictEqual(chapterRequests(site), [ch7]);
    n = db.getNovel(id);
    assert.strictEqual(n.last_error, null);
    assert.strictEqual(epubChapters(fs.readFileSync(n.epub_path)).size, 7);

    // Backoff doubles per attempt: 1h, 2h, 4h, 8h.
    assert.deepStrictEqual([1, 2, 3, 4].map(a => (Date.parse(nextRetryAt(a, 60, 0))) / 3_600_000), [1, 2, 4, 8]);

    // Scheduling: due when requested, never checked, or interval passed since the last start; never when paused.
    const t = Date.now(), ago = min => new Date(t - min * 60_000).toISOString();
    const due = { status: "active", check_interval_min: 60, check_requested_at: null };
    assert.ok(isDue({ ...due, last_checked_at: null }, t));
    assert.ok(!isDue({ ...due, last_checked_at: ago(59) }, t));
    assert.ok(isDue({ ...due, last_checked_at: ago(60) }, t));
    assert.ok(isDue({ ...due, last_checked_at: ago(1), check_requested_at: ago(0) }, t), "check now");
    assert.ok(!isDue({ ...due, status: "paused", last_checked_at: null, check_requested_at: ago(0) }, t));

    // A URL that yields no chapters (unsupported page) is an error, not a silent "0/0" novel.
    const empty = mockSite(0);
    const bare = db.addNovel(`${BASE}?empty`); // distinct toc_url; served as the 0-chapter site
    await checkNovel(db, createScraper({ fetch: url => empty.fetch(String(url).replace("?empty", "")) }), bare, quiet);
    assert.match(db.getNovel(bare.id).last_error, /No chapters found/);

    // Sites without a dedicated WebToEpub parser fall back to DefaultParser, which can't be configured
    // headless and turns any page's links into junk "chapters": reject them as unsupported.
    const generic = "https://unknown-site.example/story";
    const genericFetch = async url => {
        const ok = String(url) === generic;
        const res = new Response(ok ? `<html><head><title>Blog</title></head><body><a href="${generic}/1">Post</a></body></html>` : "nf",
            { status: ok ? 200 : 404, headers: { "content-type": "text/html" } });
        Object.defineProperty(res, "url", { value: String(url) });
        return res;
    };
    const blog = db.addNovel(generic);
    await checkNovel(db, createScraper({ fetch: genericFetch }), blog, quiet);
    assert.match(db.getNovel(blog.id).last_error, /No WebToEpub parser for this site/);
    assert.deepStrictEqual(db.chapters(blog.id), [], "nothing stored for unsupported sites");

    // Deleted (or paused) mid-check: stop fetching the remaining chapters right away.
    const big = mockSite(6);
    const long = db.addNovel(`${BASE}?long`);
    const s6 = createScraper({ fetch: url => big.fetch(String(url).replace("?long", "")) });
    let fetched = 0;
    const deletingScraper = { ...s6, getChapter: async (...a) => { fetched++; const r = await s6.getChapter(...a);
        if (fetched === 2) db.deleteNovel(long.id); return r; } };
    await checkNovel(db, deletingScraper, long, quiet);
    assert.strictEqual(fetched, 2, "no chapters fetched after the novel was deleted");

    // A novel deleted from the UI before/while the worker checks it: no throw, nothing rebuilt.
    const doomed = db.addNovel(`${BASE}?deleted`);
    db.deleteNovel(doomed.id);
    await checkNovel(db, s, doomed, quiet);
    assert.strictEqual(db.getNovel(doomed.id), undefined);

    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log("✓ pipeline test passed");
})().catch(e => { console.error("✗", e); process.exit(1); });
