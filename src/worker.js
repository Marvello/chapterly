// Checks novels for new chapters, stores each chapter as soon as it's fetched,
// and rebuilds the novel's EPUB in the library folder when anything new arrived.
"use strict";
const fs = require("fs");
const path = require("path");
const { diffChapters } = require("./diff");

const LIBRARY = () => process.env.NOVEL_LIBRARY || path.join(__dirname, "..", "library");
// Chapter retries across checks: after the nth failure wait RETRY_BASE_MIN * 2^(n-1)
// (1h, 2h, 4h, 8h by default); after MAX_ATTEMPTS failures stop until `cli.js retry <id>`.
const retryPolicy = () => ({
    maxAttempts: Number(process.env.NOVEL_MAX_ATTEMPTS || 5),
    retryBaseMin: Number(process.env.NOVEL_RETRY_BASE_MIN || 60),
});
const nextRetryAt = (attempts, baseMin, at = Date.now()) =>
    new Date(at + baseMin * 60_000 * 2 ** (attempts - 1)).toISOString();

const safeName = s => String(s || "Unknown").replace(/[/\\:*?"<>|\x00-\x1f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 150);

/**
 * One check of one novel: refresh the TOC, fetch pending chapters one by one, rebuild the EPUB.
 * Never throws; errors are recorded on the novel.
 */
async function checkNovel(db, scraper, novelRow, log = console.log, { maxAttempts, retryBaseMin } = retryPolicy()) {
    const id = novelRow.id;
    db.markCheckStarted(id);
    let error = null;
    try {
        const novel = await scraper.getNovel(novelRow.toc_url);
        // DefaultParser needs per-site CSS set up in the extension's UI; headless it turns any page's
        // links into junk "chapters". Only sites with a dedicated WebToEpub parser are supported.
        if (novel.usingDefaultParser) throw new Error(`No WebToEpub parser for this site (${new URL(novelRow.toc_url).hostname})`);
        if (!novel.chapters.length) throw new Error(`No chapters found at ${novelRow.toc_url} (parser ${novel.parser})`);
        db.updateNovelMeta(id, novel);
        const { added } = diffChapters(db.chapters(id), novel.chapters);
        db.addChapters(id, added);

        const pending = db.pendingChapters(id, maxAttempts);
        if (added.length || pending.length) log(`[${id}] ${novel.title}: ${added.length} new, ${pending.length} to fetch`);
        let failed = 0;
        for (const [i, c] of pending.entries()) {
            // Deleted or paused from the UI mid-check: stop now instead of fetching the rest.
            if (db.getNovel(id)?.status !== "active") {
                log(`[${id}] deleted or paused, stopping this check`);
                break;
            }
            try {
                const ch = await scraper.getChapter(novel, c.url);
                db.saveChapter(c.id, ch.html);
                log(`[${id}]   ${i + 1}/${pending.length} ${c.title || c.url}`);
            } catch (e) {
                failed++;
                const attempts = c.attempts + 1;
                const retryAt = attempts < maxAttempts ? nextRetryAt(attempts, retryBaseMin) : null;
                db.failChapter(c.id, e.message, retryAt);
                log(`[${id}]   ✗ ${c.url} (attempt ${attempts}/${maxAttempts}${retryAt ? `, retry after ${retryAt}` : ", giving up"}): ${e.message}`);
            }
        }
        const gaveUp = db.gaveUpChapters(id, maxAttempts).length;
        error = [
            failed && `${failed} chapter(s) failed this check`,
            gaveUp && `${gaveUp} chapter(s) gave up after ${maxAttempts} attempts (\`node cli.js retry ${id}\` to try again)`,
        ].filter(Boolean).join("; ") || null;
    } catch (e) {
        error = e.message;
        log(`[${id}] ✗ ${error}`);
    }
    // Rebuild even after a partial failure, so chapters that did arrive reach the reader.
    if (db.epubStale(id)) {
        try {
            const file = await buildEpub(db, scraper, id);
            log(`[${id}] EPUB written: ${file}`);
        } catch (e) {
            error = [error, `EPUB build failed: ${e.message}`].filter(Boolean).join("; ");
            log(`[${id}] ✗ EPUB build failed: ${e.message}`);
        }
    }
    db.markCheckDone(id, error);
}

/** Pack all fetched chapters and write to <library>/<Author>/<Title>/<Title>.epub (atomically). */
async function buildEpub(db, scraper, id) {
    const n = db.getNovel(id);
    const chapters = db.chapters(id).filter(c => c.html != null);
    const buf = await scraper.buildEpub(
        { tocUrl: n.toc_url, title: n.title, author: n.author, language: n.language,
            subjects: n.subjects, description: n.description, cover: n.cover_url },
        chapters.map(c => ({ url: c.url, title: c.title, html: c.html })));
    // Keep the first path forever, even if the site later renames the novel,
    // so Audiobookshelf keeps treating it as the same item (and keeps reading progress).
    const file = n.epub_path || path.join(LIBRARY(), safeName(n.author), safeName(n.title), `${safeName(n.title)}.epub`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = path.join(path.dirname(file), `.${path.basename(file)}.tmp`);
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, file);   // atomic on the same filesystem: readers never see a half-written file
    db.markEpubBuilt(id, file);
    return file;
}

const isDue = (n, at = Date.now()) => n.status === "active" && (!!n.check_requested_at || !n.last_checked_at ||
    at - Date.parse(n.last_checked_at) >= n.check_interval_min * 60_000);

/** Check every due novel, one at a time (so at most one request per site at once). */
async function checkDue(db, scraper, log = console.log) {
    for (const n of db.listNovels().filter(n => isDue(n))) {
        await checkNovel(db, scraper, n, log);
    }
}

/** Publish the hostnames WebToEpub has a dedicated parser for, so the web form can validate URLs. */
function syncSupportedSites(db, scraper) {
    db.replaceSupportedSites(scraper.supportedHosts());
}

/** Run forever: wake every `tickMin` minutes and check whichever novels are due. */
async function runLoop(db, scraper, { tickMin = Number(process.env.NOVEL_TICK_MIN || 1), log = console.log } = {}) {
    syncSupportedSites(db, scraper);
    log(`worker started: checking due novels every ${tickMin} min`);
    for (;;) {
        await checkDue(db, scraper, log);
        await new Promise(r => setTimeout(r, tickMin * 60_000));
    }
}

module.exports = { checkNovel, checkDue, buildEpub, runLoop, isDue, nextRetryAt, syncSupportedSites };
