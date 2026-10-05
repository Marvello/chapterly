// The only module that talks to the database; everything else calls these functions.
// SQLite via node:sqlite today. The SQL is kept portable (see migrations/) so moving to
// Postgres means swapping this file's internals, not its callers.
"use strict";
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const MIGRATIONS_DIR = path.join(__dirname, "migrations");
const now = () => new Date().toISOString();
const normEmail = e => String(e).trim().toLowerCase();
const normHost = h => String(h).trim().toLowerCase().replace(/^www\./, "");
const CHAPTER_COLS = "id, idx, url, title, fetched_at, error, attempts, retry_at, (html IS NOT NULL) AS fetched";

function openDb(file = process.env.CHAPTERLY_DB || path.join(__dirname, "..", "data", "chapterly.db")) {
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new DatabaseSync(file);
    // busy_timeout first: switching to WAL takes a lock, and a second process starting at the same
    // moment (web + worker) must wait for it instead of failing with "database is locked".
    db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    migrate(db);
    const one = (sql, ...p) => db.prepare(sql).get(...p);
    const all = (sql, ...p) => db.prepare(sql).all(...p);
    const run = (sql, ...p) => db.prepare(sql).run(...p);
    const tx = fn => {
        db.exec("BEGIN IMMEDIATE");   // take the write lock up front: read-then-write can't hit SQLITE_BUSY_SNAPSHOT
        try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; }
    };

    return {
        close: () => db.close(),

        addNovel(tocUrl) {
            run("INSERT INTO novels (toc_url, created_at) VALUES (?, ?) ON CONFLICT (toc_url) DO NOTHING", tocUrl, now());
            return one("SELECT * FROM novels WHERE toc_url = ?", tocUrl);
        },
        getNovel: id => one("SELECT * FROM novels WHERE id = ?", id),
        findNovelByUrl: url => one("SELECT * FROM novels WHERE toc_url = ?", url),
        /**
         * @param newSince ISO time; chapters fetched at/after it count as "new". novelId: just that novel.
         * Uses fetched_at (set together with html) so chapters_stats_idx covers it without reading html.
         */
        listNovels: (newSince = now(), novelId = null) => all(`
            SELECT n.*, COUNT(c.id) AS chapters_total, COUNT(c.fetched_at) AS chapters_fetched,
                   COALESCE(SUM(CASE WHEN c.fetched_at IS NULL AND c.attempts > 0 THEN 1 ELSE 0 END), 0) AS chapters_failing,
                   COALESCE(SUM(CASE WHEN c.fetched_at >= ? THEN 1 ELSE 0 END), 0) AS chapters_new,
                   MAX(c.fetched_at) AS last_fetched_at,
                   MIN(CASE WHEN c.fetched_at IS NULL THEN c.retry_at END) AS next_retry_at
            FROM novels n LEFT JOIN chapters c ON c.novel_id = n.id
            WHERE (? IS NULL OR n.id = ?)
            GROUP BY n.id ORDER BY n.id`, newSince, novelId, novelId),
        /** Active novels whose last check started but never finished (worker stopped mid-check). */
        interruptedChecks: () => all(`SELECT * FROM novels WHERE status = 'active' AND last_checked_at IS NOT NULL
              AND last_checked_at > COALESCE(check_finished_at, '') ORDER BY id`),
        requestCheck: id => run("UPDATE novels SET check_requested_at = ? WHERE id = ?", now(), id),
        /** Your choice: from now on the site's status never overrides it. */
        setSeriesStatus: (id, status) =>
            run("UPDATE novels SET series_status = ?, series_status_manual = 1 WHERE id = ?", status, id),
        /** Status read from the site; ignored once you've set it yourself. */
        applySiteSeriesStatus: (id, status) =>
            run("UPDATE novels SET series_status = ? WHERE id = ? AND series_status_manual = 0", status, id),
        setCheckInterval: (id, minutes) => run("UPDATE novels SET check_interval_min = ? WHERE id = ?", minutes, id),
        setStatus: (id, status) => run("UPDATE novels SET status = ? WHERE id = ?", status, id),
        deleteNovel: id => run("DELETE FROM novels WHERE id = ?", id),

        updateNovelMeta(id, m) {
            run(`UPDATE novels SET parser = ?, title = ?, author = ?, language = ?, subjects = ?,
                 description = ?, cover_url = ? WHERE id = ?`,
                m.parser, m.title, m.author, m.language, m.subjects, m.description, m.cover, id);
        },
        /** Record the start of a check (the next one is due `interval` after this start); consumes a "check now". */
        markCheckStarted: id =>
            run("UPDATE novels SET last_checked_at = ?, check_requested_at = NULL WHERE id = ?", now(), id),
        /** checkRetryAt: set when the whole check failed (counts a check failure); null resets the count. */
        markCheckDone(id, error, checkRetryAt = null) {
            run(`UPDATE novels SET check_retry_at = ?,
                 check_failures = CASE WHEN ? IS NULL THEN 0 ELSE check_failures + 1 END WHERE id = ?`,
                checkRetryAt, checkRetryAt, id);
            if (error) run("UPDATE novels SET last_error = ?, check_finished_at = ? WHERE id = ?", error, now(), id);
            else run("UPDATE novels SET last_error = NULL, last_success_at = ?, check_finished_at = ? WHERE id = ?", now(), now(), id);
        },
        epubPathTaken: (epubPath, exceptId) =>
            !!one("SELECT 1 AS x FROM novels WHERE epub_path = ? AND id != ?", epubPath, exceptId),
        markEpubBuilt: (id, epubPath) =>
            run("UPDATE novels SET epub_path = ?, epub_built_at = ? WHERE id = ?", epubPath, now(), id),

        chapters: novelId => all("SELECT * FROM chapters WHERE novel_id = ? ORDER BY idx, id", novelId),
        /** What the TOC diff needs, without loading every chapter's html. */
        chapterKeys: novelId => all("SELECT url, title FROM chapters WHERE novel_id = ?", novelId),
        /** Unfetched chapters that are due: under the attempt limit and past their backoff. */
        pendingChapters: (novelId, maxAttempts) =>
            all(`SELECT * FROM chapters WHERE novel_id = ? AND html IS NULL AND attempts < ?
                 AND (retry_at IS NULL OR retry_at <= ?) ORDER BY idx, id`, novelId, maxAttempts, now()),
        /** Chapters that hit the attempt limit and are no longer retried automatically. */
        gaveUpChapters: (novelId, maxAttempts) =>
            all("SELECT * FROM chapters WHERE novel_id = ? AND html IS NULL AND attempts >= ? ORDER BY idx, id",
                novelId, maxAttempts),
        clearGaveUpRetries: (novelId, maxAttempts) =>
            run("UPDATE chapters SET retry_at = NULL WHERE novel_id = ? AND html IS NULL AND attempts >= ? AND retry_at IS NOT NULL",
                novelId, maxAttempts),
        /** Give failed chapters a fresh set of attempts, due immediately. */
        resetChapterRetries: novelId =>
            run("UPDATE chapters SET attempts = 0, retry_at = NULL WHERE novel_id = ? AND html IS NULL", novelId),
        /** Insert newly listed chapters as pending rows (html NULL). */
        addChapters(novelId, list) {
            tx(() => {
                for (const c of list) {
                    run(`INSERT INTO chapters (novel_id, idx, url, title) VALUES (?, ?, ?, ?)
                         ON CONFLICT (novel_id, url) DO NOTHING`, novelId, c.index, c.url, c.title);
                }
            });
        },
        /** html must already be cleaned (worker/src/clean.js); cleanVersion = its CLEAN_VERSION. */
        saveChapter: (id, html, cleanVersion) =>
            run("UPDATE chapters SET html = ?, html_clean = ?, error = NULL, retry_at = NULL, fetched_at = ? WHERE id = ?",
                html, cleanVersion, now(), id),
        failChapter: (id, error, retryAt) =>
            run("UPDATE chapters SET error = ?, attempts = attempts + 1, retry_at = ? WHERE id = ?", error, retryAt, id),
        /** Chapter list page without html (novels can have thousands of chapters). Newest first. */
        chapterPage: (novelId, limit, offset) =>
            all(`SELECT ${CHAPTER_COLS} FROM chapters WHERE novel_id = ? ORDER BY idx DESC, id DESC LIMIT ? OFFSET ?`,
                novelId, limit, offset),
        chapterCount: novelId => one("SELECT COUNT(*) AS n FROM chapters WHERE novel_id = ?", novelId).n,
        failingChapters: novelId =>
            all(`SELECT ${CHAPTER_COLS} FROM chapters WHERE novel_id = ? AND html IS NULL AND attempts > 0 ORDER BY idx, id`,
                novelId),

        /** Worker liveness, stamped every tick (and per chapter during long checks). */
        heartbeat: () => run(`INSERT INTO worker_status (id, seen_at) VALUES (1, ?)
            ON CONFLICT (id) DO UPDATE SET seen_at = excluded.seen_at`, now()),
        workerSeenAt: () => one("SELECT seen_at FROM worker_status WHERE id = 1")?.seen_at ?? null,

        /** Replace the list of hostnames with a dedicated WebToEpub parser. */
        replaceSupportedSites(hosts) {
            tx(() => {
                run("DELETE FROM supported_sites");
                for (const h of new Set(hosts.map(normHost))) run("INSERT INTO supported_sites (host) VALUES (?)", h);
            });
        },
        /** true / false, or null while the list is still empty (worker hasn't published it yet). */
        isSupportedHost(host) {
            if (!one("SELECT 1 AS x FROM supported_sites LIMIT 1")) return null;
            return !!one("SELECT 1 AS x FROM supported_sites WHERE host = ?", normHost(host));
        },

        createUser({ email, name, passwordHash }) {
            run("INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)",
                normEmail(email), name ?? null, passwordHash, now());
            return one("SELECT * FROM users WHERE email = ?", normEmail(email));
        },
        getUserByEmail: email => one("SELECT * FROM users WHERE email = ?", normEmail(email)),
        getUserById: id => one("SELECT * FROM users WHERE id = ?", id),
        getUserByOidcSub: sub => one("SELECT * FROM users WHERE oidc_sub = ?", sub),
        /** New password: bumps session_version (logs out every existing session) and clears lockout. */
        setPassword: (id, passwordHash) => run(`UPDATE users SET password_hash = ?, session_version = session_version + 1,
            failed_logins = 0, locked_until = NULL WHERE id = ?`, passwordHash, id),
        recordLoginFailure: (id, lockedUntil) =>
            run("UPDATE users SET failed_logins = failed_logins + 1, locked_until = ? WHERE id = ?", lockedUntil, id),
        recordLoginSuccess: id => run("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?", id),
        /** Binds only if the user has no OIDC identity yet; returns rows changed (0 = refused). */
        bindOidcSub: (id, sub) => Number(run("UPDATE users SET oidc_sub = ? WHERE id = ? AND oidc_sub IS NULL", sub, id).changes),
        /** Also bumps session_version: sessions signed in through the old identity are logged out. */
        unlinkOidc: id => run("UPDATE users SET oidc_sub = NULL, session_version = session_version + 1 WHERE id = ?", id),

        // ── Reader ── chapter order is (idx, id) everywhere: idx is not unique per novel.
        /** Per novel (or just novelId): progress for this user and `unread` = fetched chapters after it (all when not started). */
        readerLibrary: (userId, novelId = null) => all(`
            SELECT n.id, n.title, n.author, n.cover_url, n.toc_url,
                   p.chapter_id AS progress_chapter_id, pc.idx AS progress_idx, p.fraction AS progress_fraction, p.read_at,
                   COUNT(c.html) AS chapters_fetched,
                   COALESCE(SUM(CASE WHEN c.html IS NOT NULL AND (p.chapter_id IS NULL OR c.idx > pc.idx
                                     OR (c.idx = pc.idx AND c.id > pc.id)) THEN 1 ELSE 0 END), 0) AS unread
            FROM novels n
            LEFT JOIN reading_progress p ON p.novel_id = n.id AND p.user_id = ?
            LEFT JOIN chapters pc ON pc.id = p.chapter_id
            LEFT JOIN chapters c ON c.novel_id = n.id
            WHERE (? IS NULL OR n.id = ?)
            GROUP BY n.id ORDER BY n.id`, userId, novelId, novelId),
        readerToc: novelId =>
            all("SELECT id, idx, title FROM chapters WHERE novel_id = ? AND html IS NOT NULL ORDER BY idx, id", novelId),
        /** Fetched chapters (with html) after `afterChapterId` in (idx, id) order; from the start when null. */
        readerChapters(novelId, afterChapterId, limit) {
            const lim = Math.min(Math.max(1, limit), 200);
            if (!afterChapterId) {
                return all(`SELECT id, novel_id, idx, title, html, html_clean FROM chapters
                            WHERE novel_id = ? AND html IS NOT NULL ORDER BY idx, id LIMIT ?`, novelId, lim);
            }
            return all(`SELECT c.id, c.novel_id, c.idx, c.title, c.html, c.html_clean FROM chapters c, chapters a
                        WHERE a.id = ? AND a.novel_id = ? AND c.novel_id = a.novel_id AND c.html IS NOT NULL
                          AND (c.idx > a.idx OR (c.idx = a.idx AND c.id > a.id))
                        ORDER BY c.idx, c.id LIMIT ?`, afterChapterId, novelId, lim);
        },
        saveCleanHtml: (chapterId, html, cleanVersion) =>
            run("UPDATE chapters SET html = ?, html_clean = ? WHERE id = ?", html, cleanVersion, chapterId),
        getProgress: (userId, novelId) => one(`
            SELECT p.novel_id AS novelId, p.chapter_id AS chapterId, c.idx, p.fraction, p.read_at AS readAt
            FROM reading_progress p JOIN chapters c ON c.id = p.chapter_id
            WHERE p.user_id = ? AND p.novel_id = ?`, userId, novelId) ?? null,
        /**
         * Saves only a further position (by idx, id, fraction) unless `force` (the reader confirmed moving back).
         * Returns the stored position either way and whether this call changed it.
         */
        saveProgress(userId, { novelId, chapterId, fraction, readAt, force }) {
            return tx(() => {
                const ch = one("SELECT id, idx FROM chapters WHERE id = ? AND novel_id = ?", chapterId, novelId);
                if (!ch) throw new Error(`chapter ${chapterId} is not in novel ${novelId}`);
                const cur = one(`SELECT p.chapter_id, p.fraction, c.idx FROM reading_progress p
                                 JOIN chapters c ON c.id = p.chapter_id WHERE p.user_id = ? AND p.novel_id = ?`, userId, novelId);
                const further = !cur || ch.idx > cur.idx || (ch.idx === cur.idx &&
                    (ch.id > cur.chapter_id || (ch.id === cur.chapter_id && fraction > cur.fraction)));
                const saved = !!(force || further);
                if (saved) {
                    run(`INSERT INTO reading_progress (user_id, novel_id, chapter_id, fraction, read_at, updated_at)
                         VALUES (?, ?, ?, ?, ?, ?)
                         ON CONFLICT (user_id, novel_id) DO UPDATE SET chapter_id = excluded.chapter_id,
                           fraction = excluded.fraction, read_at = excluded.read_at, updated_at = excluded.updated_at`,
                        userId, novelId, chapterId, fraction, readAt, now());
                }
                const position = one(`SELECT p.novel_id AS novelId, p.chapter_id AS chapterId, c.idx, p.fraction,
                                             p.read_at AS readAt
                                      FROM reading_progress p JOIN chapters c ON c.id = p.chapter_id
                                      WHERE p.user_id = ? AND p.novel_id = ?`, userId, novelId) ?? null;
                return { saved, position };
            });
        },
        setEpubEnabled: (id, on) => run("UPDATE novels SET epub_enabled = ? WHERE id = ?", on ? 1 : 0, id),
        /** True when chapters were fetched after the EPUB was last built (or it was never built). */
        epubStale(novelId) {
            const r = one(`SELECT n.epub_built_at AS built, MAX(c.fetched_at) AS latest
                           FROM novels n LEFT JOIN chapters c ON c.novel_id = n.id WHERE n.id = ? GROUP BY n.id`, novelId);
            return !!r?.latest && (!r.built || r.latest > r.built);
        },
    };
}

// common-tech migration style: migrations/NNN_name.sql applied in order, one ledger row each.
// The whole run holds SQLite's write lock (BEGIN IMMEDIATE), so the web app and the worker
// starting together serialize here — SQLite's stand-in for pg_advisory_lock.
function migrate(db) {
    db.exec("BEGIN IMMEDIATE");
    try {
        db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`);
        const done = new Set(db.prepare("SELECT version FROM schema_migrations").all().map(r => r.version));
        const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => /^\d{3}_.+\.sql$/.test(f)).sort();
        for (const file of files) {
            const version = file.slice(0, 3);
            if (done.has(version)) continue;
            try {
                db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
            } catch (e) {
                throw new Error(`migration ${file} failed: ${e.message}`);
            }
            db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)")
                .run(version, file.replace(/\.sql$/, ""), now());
        }
        db.exec("COMMIT");
    } catch (e) {
        db.exec("ROLLBACK");
        throw e;
    }
}

module.exports = { openDb };
