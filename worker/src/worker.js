// Checks novels for new chapters, stores each chapter as soon as it's fetched,
// and rebuilds the novel's EPUB in the library folder when anything new arrived.
"use strict";
const fs = require("fs");
const path = require("path");
const { diffChapters } = require("./diff");
const { createAbsNotifier, absConfigFromEnv } = require("./audiobookshelf");
const { clean, CLEAN_VERSION } = require("./clean");

const LIBRARY = () => process.env.CHAPTERLY_LIBRARY || path.join(__dirname, "..", "..", "library");
// Chapter retries across checks: after the nth failure wait RETRY_BASE_MIN * 2^(n-1)
// (1h, 2h, 4h, 8h by default; the novel is checked as soon as a retry is due, not only on its interval);
// after MAX_ATTEMPTS failures stop until `cli.js retry <id>`. A check that fails as a whole (TOC fetch)
// backs off the same way, with no limit: once the wait passes the novel's interval, the interval wins.
// Any single wait is capped at a week (an uncapped 2^n overflows Date after ~33 failures).
const WEEK_MIN = 7 * 24 * 60;
const retryPolicy = () => ({
    maxAttempts: Number(process.env.CHAPTERLY_MAX_ATTEMPTS || 5),
    retryBaseMin: Number(process.env.CHAPTERLY_RETRY_BASE_MIN || 60),
});
const nextRetryAt = (attempts, baseMin, at = Date.now()) =>
    new Date(at + Math.min(baseMin * 2 ** Math.min(attempts - 1, 30), WEEK_MIN) * 60_000).toISOString();

/**
 * One path segment: no separators/control chars, no leading dots ("..", hidden files), never empty, and at most
 * 180 UTF-8 bytes (NAME_MAX is 255 bytes, not characters: CJK titles are 3 bytes each) so "<name> (#id).epub" fits.
 */
function safeName(s) {
    const name = String(s ?? "").replace(/[/\\:*?"<>|\x00-\x1f]/g, "_").replace(/\s+/g, " ").trim()
        .replace(/^\.+/, "").trim() || "Unknown";
    let out = "";
    for (const ch of name) {   // by code point, so a character is never cut in half
        if (Buffer.byteLength(out + ch) > 180) break;
        out += ch;
    }
    return out.trim();
}

/**
 * One check of one novel: refresh the TOC, fetch pending chapters one by one, rebuild the EPUB.
 * Never throws; errors are recorded on the novel.
 */
/**
 * opts: maxAttempts / retryBaseMin (default: env retry policy) and onEpubWritten(title), e.g. the
 * Audiobookshelf rescan, called only when this check actually rewrote the EPUB.
 */
async function checkNovel(db, scraper, novelRow, log = console.log, opts = {}) {
    const { maxAttempts, retryBaseMin, onEpubWritten } = { ...retryPolicy(), ...opts };
    const id = novelRow.id;
    db.markCheckStarted(id);
    let error = null, checkRetryAt = null;
    try {
        const novel = await scraper.getNovel(novelRow.toc_url);
        // DefaultParser needs per-site CSS set up in the extension's UI; headless it turns any page's
        // links into junk "chapters". Only sites with a dedicated WebToEpub parser are supported.
        if (novel.usingDefaultParser) throw new Error(`No WebToEpub parser for this site (${new URL(novelRow.toc_url).hostname})`);
        if (!novel.chapters.length) throw new Error(`No chapters found at ${novelRow.toc_url} (parser ${novel.parser})`);
        db.updateNovelMeta(id, novel);
        if (novel.siteStatus) db.applySiteSeriesStatus(id, novel.siteStatus);
        const { added } = diffChapters(db.chapterKeys(id), novel.chapters);
        db.addChapters(id, added);

        const pending = db.pendingChapters(id, maxAttempts);
        if (added.length || pending.length) log(`[${id}] ${novel.title}: ${added.length} new, ${pending.length} to fetch`);
        let failed = 0;
        for (const [i, c] of pending.entries()) {
            // Deleted or paused from the UI mid-check: stop now instead of fetching the rest.
            db.heartbeat();   // a long check spans many ticks: the worker is still alive
            if (db.getNovel(id)?.status !== "active") {
                log(`[${id}] deleted or paused, stopping this check`);
                break;
            }
            try {
                const ch = await scraper.getChapter(novel, c.url);
                db.saveChapter(c.id, clean(ch.html), CLEAN_VERSION);
                log(`[${id}]   ${i + 1}/${pending.length} ${c.title || c.url}`);
            } catch (e) {
                failed++;
                const attempts = c.attempts + 1;
                const retryAt = attempts < maxAttempts ? nextRetryAt(attempts, retryBaseMin) : null;
                db.failChapter(c.id, e.message, retryAt);
                log(`[${id}]   ✗ ${c.url} (attempt ${attempts}/${maxAttempts}${retryAt ? `, retry after ${retryAt}` : ", giving up"}): ${e.message}`);
            }
        }
        // Over the limit (e.g. CHAPTERLY_MAX_ATTEMPTS lowered) but still holding a retry_at: drop it, or the
        // past retry_at would keep the novel due on every tick.
        db.clearGaveUpRetries(id, maxAttempts);
        const gaveUp = db.gaveUpChapters(id, maxAttempts).length;
        error = [
            failed && `${failed} chapter(s) failed this check`,
            gaveUp && `${gaveUp} chapter(s) gave up after ${maxAttempts} attempts (\`node cli.js retry ${id}\` to try again)`,
        ].filter(Boolean).join("; ") || null;
    } catch (e) {
        error = e.message;
        checkRetryAt = nextRetryAt((novelRow.check_failures || 0) + 1, retryBaseMin);
        log(`[${id}] ✗ ${error} (retry after ${checkRetryAt})`);
    }
    // Rebuild even after a partial failure, so chapters that did arrive reach the reader.
    if (db.getNovel(id)?.epub_enabled && db.epubStale(id)) {
        try {
            const file = await buildEpub(db, scraper, id);
            await onEpubWritten?.(db.getNovel(id)?.title || novelRow.toc_url);
            log(`[${id}] EPUB written: ${file}`);
        } catch (e) {
            error = [error, `EPUB build failed: ${e.message}`].filter(Boolean).join("; ");
            log(`[${id}] ✗ EPUB build failed: ${e.message}`);
        }
    }
    db.markCheckDone(id, error, checkRetryAt);
}

/** Pack all fetched chapters and write to <library>/<Author>/<Title>/<Title>.epub (atomically). */
async function buildEpub(db, scraper, id) {
    const n = db.getNovel(id);
    const chapters = db.chapters(id).filter(c => c.html != null);
    for (const c of chapters) {
        // Stored under older cleaning rules: clean again, once, and keep the result for the reader too.
        if (c.html_clean < CLEAN_VERSION) db.saveCleanHtml(c.id, c.html = clean(c.html), CLEAN_VERSION);
    }
    const buf = await scraper.buildEpub(
        { tocUrl: n.toc_url, title: n.title, author: n.author, language: n.language,
            subjects: n.subjects, description: n.description, cover: n.cover_url },
        chapters.map(c => ({ url: c.url, title: c.title, html: c.html })));
    // Keep the first path forever, even if the site later renames the novel,
    // so Audiobookshelf keeps treating it as the same item (and keeps reading progress).
    const pathFor = name => path.join(LIBRARY(), safeName(n.author), name, `${name}.epub`);
    let file = n.epub_path || pathFor(safeName(n.title));
    // Same author + title as another novel: don't overwrite its EPUB.
    if (!n.epub_path && db.epubPathTaken(file, id)) file = pathFor(`${safeName(n.title)} (#${id})`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // pid: a CLI build and the worker may write the same novel at once.
    const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, file);   // atomic on the same filesystem: readers never see a half-written file
    db.markEpubBuilt(id, file);
    return file;
}

/**
 * Due when active and: "check now" requested, the backoff of a failed check or chapter passed, never
 * checked, or the interval passed since the last start. While a failed check's backoff runs, chapter retries
 * wait for it too (the site is likely down: don't refetch the TOC every tick).
 * Completed + every chapter fetched → never (only "check now"); dropped → at most weekly.
 */
function isDue(n, at = Date.now()) {
    if (n.status !== "active") return false;
    if (n.check_requested_at) return true;
    const retryAt = n.check_retry_at || n.next_retry_at;
    if (retryAt && Date.parse(retryAt) <= at) return true;
    if (n.series_status === "completed" && n.chapters_total > 0 && n.chapters_fetched >= n.chapters_total) return false;
    const intervalMin = n.series_status === "dropped" ? Math.max(n.check_interval_min, WEEK_MIN) : n.check_interval_min;
    return !n.last_checked_at || at - Date.parse(n.last_checked_at) >= intervalMin * 60_000;
}

/** Check every due novel, one at a time (so at most one request per site at once). */
async function checkDue(db, scraper, log = console.log, opts = {}) {
    // "Check now" (from the UI or a resumed interrupted check) goes before routine scheduled checks.
    const due = db.listNovels().filter(n => isDue(n))
        .sort((a, b) => Number(!!b.check_requested_at) - Number(!!a.check_requested_at));
    for (const n of due) {
        // checkNovel records its own errors; anything escaping it must not kill the worker (crash-loop).
        try { await checkNovel(db, scraper, n, log, opts); } catch (e) { log(`[${n.id}] ✗ check crashed: ${e.stack || e}`); }
    }
}

/**
 * On startup: resume checks the worker was stopped in the middle of (restart, redeploy, crash). An interruption
 * counts as a failed check: the first is resumed right away ("check now"); another one before a check succeeds
 * (e.g. this novel OOMs the worker) backs off like any failed check instead of crash-looping ahead of the rest.
 */
function resumeInterruptedChecks(db, log = console.log, { retryBaseMin } = retryPolicy()) {
    const cut = db.interruptedChecks();
    for (const n of cut) {
        const again = n.check_failures > 0;
        db.markCheckDone(n.id, "Interrupted: the worker stopped mid-check",
            again ? nextRetryAt(n.check_failures + 1, retryBaseMin) : new Date().toISOString());
        if (again) log(`[${n.id}] interrupted again, retrying after the backoff`);
        else db.requestCheck(n.id);
    }
    if (cut.length) log(`resuming ${cut.length} interrupted check(s)`);
}

/** Publish the hostnames WebToEpub has a dedicated parser for, so the web form can validate URLs. */
function syncSupportedSites(db, scraper) {
    db.replaceSupportedSites(scraper.supportedHosts());
}

/** Run forever: wake every `tickMin` minutes and check whichever novels are due. */
async function runLoop(db, scraper, { tickMin = Number(process.env.CHAPTERLY_TICK_MIN || 1), log = console.log } = {}) {
    // As PID 1 in a container node ignores SIGTERM, so every rollout waited for the SIGKILL. Exiting mid-check is
    // safe: the EPUB write is atomic (temp file + rename) and the check is resumed on the next start.
    for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => process.exit(0));
    syncSupportedSites(db, scraper);
    resumeInterruptedChecks(db, log);
    // Throws on a partial CHAPTERLY_ABS_* config, so a typo stops the worker instead of silently skipping rescans.
    const onEpubWritten = createAbsNotifier(absConfigFromEnv(process.env), log) ?? undefined;
    if (onEpubWritten) log("Audiobookshelf rescans enabled");
    log(`worker started: checking due novels every ${tickMin} min`);
    for (;;) {
        db.heartbeat();
        await checkDue(db, scraper, log, { onEpubWritten });
        await new Promise(r => setTimeout(r, tickMin * 60_000));
    }
}

module.exports = { checkNovel, checkDue, buildEpub, runLoop, isDue, nextRetryAt, safeName, syncSupportedSites, resumeInterruptedChecks };
