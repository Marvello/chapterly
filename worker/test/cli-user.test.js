// CLI account commands, driven through a real child process with the password on stdin.
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const bcrypt = require("bcryptjs");
const { openDb } = require("../../shared/db");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "novel-cli-test-"));
const env = { ...process.env, CHAPTERLY_DB: path.join(tmp, "chapterly.db"), BCRYPT_ROUNDS: "4",
    NODE_OPTIONS: "--disable-warning=ExperimentalWarning" };
const cli = (args, input) => spawnSync(process.execPath, [path.join(__dirname, "..", "cli.js"), ...args],
    { env, input, encoding: "utf8" });

let r = cli(["user:create", "Me@Example.com", "Me"], "correct horse battery\n");
assert.strictEqual(r.status, 0, r.stderr);
assert.match(r.stdout, /"type":"security","event":"user_created","email":"me@example.com"/);
assert.ok(!r.stdout.includes("correct horse"), "password never printed");
let db = openDb(env.CHAPTERLY_DB);
let u = db.getUserByEmail("me@example.com");
assert.ok(bcrypt.compareSync("correct horse battery", u.password_hash));
assert.strictEqual(u.password_hash.startsWith("$2b$04$"), true, "cost from BCRYPT_ROUNDS");
db.close();

r = cli(["user:create", "me@example.com"], "another long password\n");
assert.notStrictEqual(r.status, 0, "duplicate email rejected");

r = cli(["user:create", "short@example.com"], "tooshort\n");
assert.notStrictEqual(r.status, 0);
assert.match(r.stderr, /at least 12 characters/);

r = cli(["user:password", "me@example.com"], "a brand new password\n");
assert.strictEqual(r.status, 0, r.stderr);
assert.match(r.stdout, /"event":"password_changed"/);
db = openDb(env.CHAPTERLY_DB);
u = db.getUserByEmail("me@example.com");
assert.ok(bcrypt.compareSync("a brand new password", u.password_hash));
assert.strictEqual(u.session_version, 2, "old sessions invalidated");
db.bindOidcSub(u.id, "sub-x");
db.close();

r = cli(["user:unlink-oidc", "me@example.com"]);
assert.strictEqual(r.status, 0, r.stderr);
db = openDb(env.CHAPTERLY_DB);
assert.strictEqual(db.getUserByEmail("me@example.com").oidc_sub, null);
db.close();

r = cli(["user:password", "nobody@example.com"], "whatever long password\n");
assert.notStrictEqual(r.status, 0);

// series <id> <status>
db = openDb(env.CHAPTERLY_DB);
const nid = db.addNovel("https://example.com/novel/cli").id;
db.close();
r = cli(["series", String(nid), "completed"]);
assert.strictEqual(r.status, 0, r.stderr);
db = openDb(env.CHAPTERLY_DB);
assert.deepStrictEqual([db.getNovel(nid).series_status, db.getNovel(nid).series_status_manual], ["completed", 1]);
db.close();
r = cli(["series", String(nid), "paused"]);
assert.notStrictEqual(r.status, 0, "only ongoing / completed / dropped");

fs.rmSync(tmp, { recursive: true, force: true });
console.log("✓ cli user test passed");
