// Offline end-to-end test: add → check (fetch all, build EPUB) → no-op check → new chapter →
// failed chapter: backoff, give up after max attempts, manual retry. Uses the synthetic site in mockSite.js.
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createScraper } = require("../src/scraper");
const { openDb } = require("../../shared/db");
const { checkNovel, checkDue, buildEpub, isDue, nextRetryAt, safeName, resumeInterruptedChecks, syncSupportedSites } = require("../src/worker");
const { mockSite, BASE } = require("./mockSite");
const { CLEAN_VERSION } = require("../src/clean");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "novel-test-"));
process.env.CHAPTERLY_LIBRARY = path.join(tmp, "library");

// Chapter file names inside the zip (each appears in the local header and the central directory).
const epubChapters = buf => new Set(buf.toString("latin1").match(/OEBPS\/Text\/\d{4}_[\w.-]+?\.xhtml/g));
const chapterRequests = site => site.requests.filter(u => /\/chapter-\d+$/.test(u));

(async () => {
    const site = mockSite(5);
    const db = openDb(path.join(tmp, "chapterly.db"));
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

    // Library path segments: no escaping the folder, no hidden/empty names, NAME_MAX counted in bytes.
    assert.deepStrictEqual(["..", " . ", "", null, ".hidden", "a/b"].map(safeName), ["Unknown", "Unknown", "Unknown", "Unknown", "hidden", "a_b"]);
    assert.strictEqual(safeName("章".repeat(200)), "章".repeat(60), "180 bytes, whole characters only");
    // Same author + title as another novel: its own folder and EPUB, never overwriting the first one.
    const twin = db.addNovel(`${BASE}?twin`).id;
    await checkNovel(db, createScraper({ fetch: url => site.fetch(String(url).replace("?twin", "")) }), db.getNovel(twin), quiet);
    assert.strictEqual(db.getNovel(twin).epub_path,
        path.join(tmp, "library", "Jane Placeholder", `Test Story (#${twin})`, `Test Story (#${twin}).epub`));
    assert.deepStrictEqual(fs.readdirSync(path.dirname(n.epub_path)), ["Test Story.epub"], "first novel's EPUB untouched");

    // A chapter stored under older cleaning rules (here: with the site's repeated "Chapter N" <h2>) is
    // cleaned again when the EPUB is built, and the result is kept for the reader too.
    {
        const { ZipReader, Uint8ArrayReader, TextWriter } = require("@zip.js/zip.js");
        const first = db.chapters(id)[0];
        db.saveCleanHtml(first.id, "<h1>Chapter 1: Scythe</h1><h2>Chapter 1: Chapter 1: Scythe</h2><p>a</p>", 1);
        await buildEpub(db, s, id);
        const entries = await new ZipReader(new Uint8ArrayReader(new Uint8Array(fs.readFileSync(n.epub_path)))).getEntries();
        const xhtml = await entries.find(e => /Text\/0000_/.test(e.filename)).getData(new TextWriter());
        assert.ok(!/<h2/.test(xhtml) && /<h1>Chapter 1: Scythe<\/h1>/.test(xhtml), "duplicate chapter heading removed");
        const row = db.chapters(id)[0];
        assert.deepStrictEqual([row.html, row.html_clean], ["<h1>Chapter 1: Scythe</h1><p>a</p>", CLEAN_VERSION], "re-clean saved");
    }

    // 2nd check, nothing new: no chapter fetches, EPUB not rebuilt, Audiobookshelf not asked to rescan.
    site.requests.length = 0;
    const builtAt = db.getNovel(id).epub_built_at;
    const rescans = [];
    await checkNovel(db, s, db.getNovel(id), quiet, { onEpubWritten: title => rescans.push(title) });
    assert.deepStrictEqual(rescans, [], "no rescan when the EPUB didn't change");
    assert.deepStrictEqual(chapterRequests(site), []);
    assert.strictEqual(db.getNovel(id).epub_built_at, builtAt);

    // Two new chapters, one of them broken: fetch only those, keep the good one, record the error.
    site.chapterCount = 7;
    const ch7 = `${BASE}/chapter-7`;
    site.broken.add(ch7);
    site.requests.length = 0;
    await checkNovel(db, s, db.getNovel(id), quiet, { onEpubWritten: title => rescans.push(title) });
    assert.deepStrictEqual(rescans, ["Test Story"], "rescan requested once the EPUB was rebuilt");
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
    // Limit lowered below a chapter's attempts: its retry_at is dropped, so it can't keep the novel due forever.
    await checkNovel(db, s, db.getNovel(id), quiet, { maxAttempts: 1 });
    assert.strictEqual(db.chapters(id).find(c => c.url === ch7).retry_at, null);
    assert.strictEqual(db.listNovels().find(r => r.id === id).next_retry_at, null);
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
    // Capped at a week, and never an invalid Date (2^n used to overflow after ~33 failed checks).
    assert.strictEqual(Date.parse(nextRetryAt(100, 60, 0)), 7 * 86_400_000);
    assert.strictEqual(Date.parse(nextRetryAt(5000, 60, 0)), 7 * 86_400_000);

    // Scheduling: due when requested, never checked, or interval passed since the last start; never when paused.
    const t = Date.now(), ago = min => new Date(t - min * 60_000).toISOString();
    const due = { status: "active", check_interval_min: 60, check_requested_at: null };
    assert.ok(isDue({ ...due, last_checked_at: null }, t));
    assert.ok(!isDue({ ...due, last_checked_at: ago(59) }, t));
    assert.ok(isDue({ ...due, last_checked_at: ago(60) }, t));
    assert.ok(isDue({ ...due, last_checked_at: ago(1), check_requested_at: ago(0) }, t), "check now");
    assert.ok(!isDue({ ...due, status: "paused", last_checked_at: null, check_requested_at: ago(0) }, t));
    // A failed chapter's backoff expiring makes the novel due before its interval.
    assert.ok(isDue({ ...due, last_checked_at: ago(1), next_retry_at: ago(0) }, t), "chapter retry due");
    assert.ok(!isDue({ ...due, last_checked_at: ago(1), next_retry_at: ago(-5) }, t), "chapter retry not yet due");
    assert.ok(!isDue({ ...due, status: "paused", last_checked_at: ago(1), next_retry_at: ago(0) }, t));
    assert.ok(isDue({ ...due, last_checked_at: ago(1), check_retry_at: ago(0) }, t), "failed check retry due");
    assert.ok(!isDue({ ...due, last_checked_at: ago(1), check_retry_at: ago(-5) }, t));
    assert.ok(!isDue({ ...due, last_checked_at: ago(1), check_retry_at: ago(-5), next_retry_at: ago(10) }, t),
        "a failed check's backoff holds chapter retries back (site down: no TOC fetch every tick)");
    assert.ok(isDue({ ...due, last_checked_at: ago(1), check_retry_at: ago(-5), check_requested_at: ago(0) }, t),
        "check now still wins over the backoff");
    // Series status: completed + everything fetched → no more scheduled checks; dropped → weekly at most.
    const done = { ...due, series_status: "completed", chapters_total: 10, chapters_fetched: 10 };
    assert.ok(!isDue({ ...done, last_checked_at: ago(100000) }, t), "finished completed novel is never due");
    assert.ok(isDue({ ...done, last_checked_at: ago(1), check_requested_at: ago(0) }, t), "check now still works");
    assert.ok(isDue({ ...done, chapters_fetched: 9, last_checked_at: ago(60) }, t), "completed but missing chapters");
    const dropped = { ...due, series_status: "dropped", check_interval_min: 1440 };
    assert.ok(!isDue({ ...dropped, last_checked_at: ago(1440 * 6) }, t));
    assert.ok(isDue({ ...dropped, last_checked_at: ago(10080) }, t));

    // The worker applies the site's status (unless you set it yourself).
    site.status = "Completed";
    await checkNovel(db, s, db.getNovel(id), quiet);
    assert.strictEqual(db.getNovel(id).series_status, "completed");
    db.setSeriesStatus(id, "ongoing");
    await checkNovel(db, s, db.getNovel(id), quiet);
    assert.strictEqual(db.getNovel(id).series_status, "ongoing", "manual choice kept");
    site.status = "OnGoing";

    // A URL that yields no chapters (unsupported page) is an error, not a silent "0/0" novel.
    const empty = mockSite(0);
    const bare = db.addNovel(`${BASE}?empty`); // distinct toc_url; served as the 0-chapter site
    await checkNovel(db, createScraper({ fetch: url => empty.fetch(String(url).replace("?empty", "")) }), bare, quiet);
    assert.match(db.getNovel(bare.id).last_error, /No chapters found/);

    // Worker restarted mid-download: the interrupted novel is resumed right away (not after its interval),
    // fetching only the chapters it didn't get, and requested novels run before merely-due ones.
    const big2 = mockSite(6);
    const cutScraper = createScraper({ fetch: url => big2.fetch(String(url).replace(/\?(cut|due)/, "")) });
    db.addNovel(`${BASE}?due`);          // older (lower id) and due, but not requested: must still go second
    const cutId = db.addNovel(`${BASE}?cut`).id;
    const toc = await cutScraper.getNovel(`${BASE}?cut`);          // state a crash after 2 chapters leaves:
    db.updateNovelMeta(cutId, toc);                                  // chapter list stored, 2 of 6 saved,
    db.addChapters(cutId, toc.chapters);                             // check started but never finished
    for (const c of db.chapters(cutId).slice(0, 2)) db.saveChapter(c.id, "<p>saved before the crash</p>", CLEAN_VERSION);
    db.markCheckStarted(cutId);
    assert.ok(!isDue(db.listNovels().find(r => r.id === cutId)), "without a resume it would wait a full interval");

    const order = [];
    const recording = { ...cutScraper, getNovel: async url => { order.push(url); return cutScraper.getNovel(url); } };
    resumeInterruptedChecks(db, quiet);
    await checkDue(db, recording, quiet);
    assert.deepStrictEqual(order.slice(0, 2), [`${BASE}?cut`, `${BASE}?due`], "resumed novel goes first");
    const cutChapters = db.chapters(cutId);
    assert.strictEqual(cutChapters.filter(c => c.html).length, 6, "all chapters present after resume");
    assert.strictEqual(cutChapters.filter(c => c.html === "<p>saved before the crash</p>").length, 2, "saved chapters not refetched");
    // Interrupted twice in a row (the novel crashes the worker): resumed once, then it backs off instead.
    await new Promise(r => setTimeout(r, 5));   // timestamps are ms: start after the last finish
    db.markCheckStarted(cutId);
    resumeInterruptedChecks(db, quiet);
    assert.ok(db.getNovel(cutId).check_requested_at, "first interruption: resumed right away");
    await new Promise(r => setTimeout(r, 5));
    db.markCheckStarted(cutId);                                       // the resumed check dies too
    resumeInterruptedChecks(db, quiet, { retryBaseMin: 60 });
    const again = db.getNovel(cutId);
    assert.strictEqual(again.check_requested_at, null, "not resumed a second time");
    assert.ok(Date.parse(again.check_retry_at) - Date.now() > 100 * 60_000, "backs off (2nd failure: 2h)");
    assert.ok(!isDue(db.listNovels().find(r => r.id === cutId)));
    assert.deepStrictEqual(db.interruptedChecks(), [], "recorded as finished (with an error)");
    db.markCheckDone(cutId, null);                                    // reset for the tests below

    // The worker publishes the supported hostnames for the web form.
    syncSupportedSites(db, s);
    assert.strictEqual(db.isSupportedHost("freewebnovel.com"), true);
    assert.strictEqual(db.isSupportedHost("example.com"), false);

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

    // Whole check fails (TOC timeout): retried after 1h, then 2h; a good check resets the backoff.
    const down = createScraper({ fetch: async () => { throw new Error("Timeout awaiting 'request' for 120000ms"); } });
    const hoursOut = () => Math.round((Date.parse(db.getNovel(id).check_retry_at) - Date.now()) / 3_600_000);
    await checkNovel(db, down, db.getNovel(id), quiet);
    assert.match(db.getNovel(id).last_error, /Timeout awaiting/);
    assert.deepStrictEqual([db.getNovel(id).check_failures, hoursOut()], [1, 1]);
    await checkNovel(db, down, db.getNovel(id), quiet);
    assert.deepStrictEqual([db.getNovel(id).check_failures, hoursOut()], [2, 2]);
    await checkNovel(db, s, db.getNovel(id), quiet);
    assert.deepStrictEqual([db.getNovel(id).check_failures, db.getNovel(id).check_retry_at], [0, null]);

    // Stored chapters are sanitized; EPUB building can be switched off per novel (and back on).
    assert.ok(db.readerChapters(id, null, 200).every(c => c.html_clean === CLEAN_VERSION), "worker stores cleaned html");
    db.setEpubEnabled(id, false);
    site.chapterCount = 8;
    const builtBefore = db.getNovel(id).epub_built_at;
    const offRescans = [];
    await checkNovel(db, s, db.getNovel(id), quiet, { onEpubWritten: t => offRescans.push(t) });
    assert.strictEqual(db.chapters(id).filter(c => c.html).length, 8, "chapters still fetched with EPUB off");
    assert.strictEqual(db.getNovel(id).epub_built_at, builtBefore, "no EPUB rebuild while off");
    assert.deepStrictEqual(offRescans, [], "no Audiobookshelf rescan while off");
    db.setEpubEnabled(id, true);
    await checkNovel(db, s, db.getNovel(id), quiet);
    assert.notStrictEqual(db.getNovel(id).epub_built_at, builtBefore, "rebuilt once switched back on");

    // A novel deleted from the UI before/while the worker checks it: no throw, nothing rebuilt.
    const doomed = db.addNovel(`${BASE}?deleted`);
    db.deleteNovel(doomed.id);
    await checkNovel(db, s, doomed, quiet);
    assert.strictEqual(db.getNovel(doomed.id), undefined);

    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log("✓ pipeline test passed");
})().catch(e => { console.error("✗", e); process.exit(1); });
