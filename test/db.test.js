// DB layer tests: migration ledger + concurrent startup. Later tasks append sections.
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { DatabaseSync } = require("node:sqlite");
const { openDb } = require("../src/db");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "novel-db-test-"));
const fresh = name => path.join(tmp, name);

(async () => {
    // Ledger uses the common-tech shape: version = NNN prefix, name = file stem.
    const db = openDb(fresh("ledger.db"));
    const raw = new DatabaseSync(fresh("ledger.db"));
    const rows = raw.prepare("SELECT version, name FROM schema_migrations ORDER BY version").all();
    assert.deepStrictEqual(rows.map(r => [r.version, r.name]).slice(0, 2),
        [["001", "001_init"], ["002", "002_chapter_retry"]]);
    raw.close();
    db.close();

    // Reopening applies nothing twice.
    openDb(fresh("ledger.db")).close();

    // Two processes starting at once on a new file: both succeed, each migration applied once.
    const file = fresh("race.db");
    const child = () => new Promise(resolve => {
        const p = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "-e",
            `require(${JSON.stringify(path.join(__dirname, "..", "src", "db.js"))}).openDb(${JSON.stringify(file)}).close()`]);
        let err = "";
        p.stderr.on("data", d => { err += d; });
        p.on("exit", code => resolve({ code, err }));
    });
    const results = await Promise.all([child(), child()]);
    assert.deepStrictEqual(results.map(r => r.code), [0, 0], results.map(r => r.err).join("\n"));
    const raw2 = new DatabaseSync(file);
    const versions = raw2.prepare("SELECT version FROM schema_migrations").all().map(r => r.version);
    assert.strictEqual(new Set(versions).size, versions.length, "no migration applied twice");
    raw2.close();

    // ---- web functions (Task 2) ----
    const w = openDb(fresh("web.db"));
    const n = w.addNovel("https://example.com/novel/a");
    assert.strictEqual(w.findNovelByUrl("https://example.com/novel/a").id, n.id);
    assert.strictEqual(w.findNovelByUrl("https://example.com/other"), undefined);
    assert.strictEqual(n.check_interval_min, 1440);

    w.requestCheck(n.id);
    assert.ok(w.getNovel(n.id).check_requested_at);
    w.markCheckStarted(n.id);
    assert.strictEqual(w.getNovel(n.id).check_requested_at, null, "starting a check clears the request");
    w.markCheckDone(n.id, null);
    assert.ok(w.getNovel(n.id).check_finished_at >= w.getNovel(n.id).last_checked_at);

    w.setCheckInterval(n.id, 4320);
    assert.strictEqual(w.getNovel(n.id).check_interval_min, 4320);

    w.addChapters(n.id, [1, 2, 3].map(i => ({ index: i, url: `https://example.com/novel/a/${i}`, title: `Ch ${i}` })));
    const [c1, c2] = w.chapters(n.id);
    w.saveChapter(c1.id, "<p>one</p>");
    w.failChapter(c2.id, "HTTP 404", null);
    const page = w.chapterPage(n.id, 2, 0);
    assert.deepStrictEqual(page.map(c => c.idx), [3, 2], "newest first, limited");
    assert.ok(!("html" in page[0]), "chapter list never carries html");
    assert.strictEqual(w.chapterPage(n.id, 2, 2)[0].fetched, 1);
    assert.strictEqual(w.chapterCount(n.id), 3);
    assert.deepStrictEqual(w.failingChapters(n.id).map(c => c.idx), [2]);

    const [row] = w.listNovels(new Date(Date.now() - 86_400_000).toISOString());
    assert.deepStrictEqual(
        [row.chapters_total, row.chapters_fetched, row.chapters_failing, row.chapters_new], [3, 1, 1, 1]);
    w.addNovel("https://example.com/novel/b");
    const [empty] = w.listNovels().filter(r => r.chapters_total === 0);
    assert.deepStrictEqual([empty.chapters_failing, empty.chapters_new], [0, 0], "counts are 0, not null");

    // users
    const u = w.createUser({ email: "  Me@Example.COM ", name: "Me", passwordHash: "h1" });
    assert.strictEqual(u.email, "me@example.com");
    assert.strictEqual(w.getUserByEmail("ME@example.com").id, u.id);
    assert.strictEqual(u.session_version, 1);
    w.recordLoginFailure(u.id, "2999-01-01T00:00:00.000Z");
    assert.deepStrictEqual([w.getUserById(u.id).failed_logins, w.getUserById(u.id).locked_until],
        [1, "2999-01-01T00:00:00.000Z"]);
    w.recordLoginSuccess(u.id);
    assert.deepStrictEqual([w.getUserById(u.id).failed_logins, w.getUserById(u.id).locked_until], [0, null]);
    w.recordLoginFailure(u.id, null);
    w.setPassword(u.id, "h2");
    const after = w.getUserById(u.id);
    assert.deepStrictEqual([after.password_hash, after.session_version, after.failed_logins], ["h2", 2, 0]);
    assert.strictEqual(w.bindOidcSub(u.id, "sub-1"), 1);
    assert.strictEqual(w.bindOidcSub(u.id, "sub-2"), 0, "never re-binds an already bound user");
    assert.strictEqual(w.getUserByOidcSub("sub-1").id, u.id);
    w.unlinkOidc(u.id);
    assert.strictEqual(w.getUserById(u.id).oidc_sub, null);
    assert.throws(() => w.createUser({ email: "me@example.com", name: null, passwordHash: "x" }), /UNIQUE/);
    w.close();

    fs.rmSync(tmp, { recursive: true, force: true });
    console.log("✓ db test passed");
})().catch(e => { console.error("✗", e); process.exit(1); });
