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

    fs.rmSync(tmp, { recursive: true, force: true });
    console.log("✓ db test passed");
})().catch(e => { console.error("✗", e); process.exit(1); });
