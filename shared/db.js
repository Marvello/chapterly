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
        db.exec("BEGIN");
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
        /** @param newSince ISO time; chapters fetched at/after it count as "new". */
        listNovels: (newSince = now()) => all(`
            SELECT n.*, COUNT(c.id) AS chapters_total, COUNT(c.html) AS chapters_fetched,
                   COALESCE(SUM(CASE WHEN c.html IS NULL AND c.attempts > 0 THEN 1 ELSE 0 END), 0) AS chapters_failing,
                   COALESCE(SUM(CASE WHEN c.fetched_at >= ? THEN 1 ELSE 0 END), 0) AS chapters_new,
                   MAX(c.fetched_at) AS last_fetched_at
            FROM novels n LEFT JOIN chapters c ON c.novel_id = n.id
            GROUP BY n.id ORDER BY n.id`, newSince),
        /** Active novels whose last check started but never finished (worker stopped mid-check) → "check now". */
        requestInterruptedChecks: () => Number(run(`UPDATE novels SET check_requested_at = ?
            WHERE status = 'active' AND check_requested_at IS NULL AND last_checked_at IS NOT NULL
              AND last_checked_at > COALESCE(check_finished_at, '')`, now()).changes),
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
        markCheckDone(id, error) {
            if (error) run("UPDATE novels SET last_error = ?, check_finished_at = ? WHERE id = ?", error, now(), id);
            else run("UPDATE novels SET last_error = NULL, last_success_at = ?, check_finished_at = ? WHERE id = ?", now(), now(), id);
        },
        markEpubBuilt: (id, epubPath) =>
            run("UPDATE novels SET epub_path = ?, epub_built_at = ? WHERE id = ?", epubPath, now(), id),

        chapters: novelId => all("SELECT * FROM chapters WHERE novel_id = ? ORDER BY idx, id", novelId),
        /** Unfetched chapters that are due: under the attempt limit and past their backoff. */
        pendingChapters: (novelId, maxAttempts) =>
            all(`SELECT * FROM chapters WHERE novel_id = ? AND html IS NULL AND attempts < ?
                 AND (retry_at IS NULL OR retry_at <= ?) ORDER BY idx, id`, novelId, maxAttempts, now()),
        /** Chapters that hit the attempt limit and are no longer retried automatically. */
        gaveUpChapters: (novelId, maxAttempts) =>
            all("SELECT * FROM chapters WHERE novel_id = ? AND html IS NULL AND attempts >= ? ORDER BY idx, id",
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
        saveChapter: (id, html) =>
            run("UPDATE chapters SET html = ?, error = NULL, retry_at = NULL, fetched_at = ? WHERE id = ?", html, now(), id),
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
        unlinkOidc: id => run("UPDATE users SET oidc_sub = NULL WHERE id = ?", id),

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
