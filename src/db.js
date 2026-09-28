// The only module that talks to the database; everything else calls these functions.
// SQLite via node:sqlite today. The SQL is kept portable (see migrations/) so moving to
// Postgres means swapping this file's internals, not its callers.
"use strict";
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const MIGRATIONS_DIR = path.join(__dirname, "..", "db", "migrations");
const now = () => new Date().toISOString();

function openDb(file = process.env.NOVEL_DB || path.join(__dirname, "..", "data", "novel.db")) {
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new DatabaseSync(file);
    db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
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
        listNovels: () => all(`
            SELECT n.*, COUNT(c.id) AS chapters_total, COUNT(c.html) AS chapters_fetched,
                   SUM(CASE WHEN c.html IS NULL AND c.attempts > 0 THEN 1 ELSE 0 END) AS chapters_failing
            FROM novels n LEFT JOIN chapters c ON c.novel_id = n.id
            GROUP BY n.id ORDER BY n.id`),
        setStatus: (id, status) => run("UPDATE novels SET status = ? WHERE id = ?", status, id),
        deleteNovel: id => run("DELETE FROM novels WHERE id = ?", id),

        updateNovelMeta(id, m) {
            run(`UPDATE novels SET parser = ?, title = ?, author = ?, language = ?, subjects = ?,
                 description = ?, cover_url = ? WHERE id = ?`,
                m.parser, m.title, m.author, m.language, m.subjects, m.description, m.cover, id);
        },
        /** Record the start of a check (so the next one is due `interval` after this start). */
        markCheckStarted: id => run("UPDATE novels SET last_checked_at = ? WHERE id = ?", now(), id),
        markCheckDone(id, error) {
            if (error) run("UPDATE novels SET last_error = ? WHERE id = ?", error, id);
            else run("UPDATE novels SET last_error = NULL, last_success_at = ? WHERE id = ?", now(), id);
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
        /** True when chapters were fetched after the EPUB was last built (or it was never built). */
        epubStale(novelId) {
            const r = one(`SELECT n.epub_built_at AS built, MAX(c.fetched_at) AS latest
                           FROM novels n LEFT JOIN chapters c ON c.novel_id = n.id WHERE n.id = ? GROUP BY n.id`, novelId);
            return !!r?.latest && (!r.built || r.latest > r.built);
        },
    };
}

// common-tech migration style: db/migrations/NNN_name.sql applied in order, one ledger row each.
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
