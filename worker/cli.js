#!/usr/bin/env node
// Usage:
//   node cli.js add     <tocUrl>                 add a novel (fetches its TOC; chapters come on `update`)
//   node cli.js list                             novels with chapter counts, last check, errors
//   node cli.js update  [id]                     check one novel now (or all active ones), fetch new chapters, rebuild EPUB
//   node cli.js build   <id>                     rebuild the EPUB from stored chapters
//   node cli.js pause|resume|remove <id>         stop/start scheduled checks, or delete the novel (EPUB file is kept)
//   node cli.js retry   <id>                     reset failed chapters' attempts so the next check retries them
//   node cli.js user:create <email> [name]       create the login account (password prompted, hidden)
//   node cli.js user:password <email>            change the password (logs out all sessions)
//   node cli.js user:unlink-oidc <email>         forget the linked authentik identity
//   node cli.js worker                           run forever: check each novel once a day (check_interval_min, default 1440)
//   node cli.js parser  <url>                    which WebToEpub parser handles the URL
//   node cli.js info    <tocUrl>                 metadata + chapter list (JSON)
//   node cli.js chapter <tocUrl> [n]             fetch chapter n (default 1) and print cleaned HTML
//   node cli.js check   <tocUrl> <known.json>    list chapters not in known.json (a saved `info` output)
// Env: CHAPTERLY_DB (default data/chapterly.db), CHAPTERLY_LIBRARY (default library/), CHAPTERLY_COOKIE, CHAPTERLY_UA,
//      CHAPTERLY_MAX_ATTEMPTS (5), CHAPTERLY_RETRY_BASE_MIN (60: chapter retry backoff 1h, 2h, 4h, 8h)
"use strict";
const fs = require("fs");
const { createScraper } = require("./src/scraper");
const { diffChapters } = require("./src/diff");
const { openDb } = require("../shared/db");
const worker = require("./src/worker");
const bcrypt = require("bcryptjs");
const { logSecurity } = require("./src/securityLog");

const [cmd, arg1, arg2] = process.argv.slice(2);
const strip = n => ({ ...n, _parser: undefined });
const usage = () => fs.readFileSync(__filename, "utf8").split("\n").slice(1, 18).join("\n");

function scraper() {
    const s = createScraper({
        headers: {
            ...(process.env.CHAPTERLY_COOKIE && { Cookie: process.env.CHAPTERLY_COOKIE }),
            ...(process.env.CHAPTERLY_UA && { "User-Agent": process.env.CHAPTERLY_UA }),
        },
    });
    if (s.loadFailures.length) console.error("WebToEpub files that failed to load:", s.loadFailures);
    return s;
}

function need(v, what) {
    if (!v) { console.error(`missing ${what}\n${usage()}`); process.exit(2); }
    return v;
}

function novelById(db, id) {
    const n = db.getNovel(Number(need(id, "<id>")));
    if (!n) throw new Error(`No novel with id ${id} (see \`node cli.js list\`)`);
    return n;
}

const MIN_PASSWORD = 12;
const rounds = () => Number(process.env.BCRYPT_ROUNDS || 12);

/** Hidden prompt (asked twice) on a terminal; first stdin line otherwise. Never an argument. */
async function readPassword() {
    const rl = require("readline").createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
    let pw;
    if (!process.stdin.isTTY) {
        for await (const line of rl) { pw = line; break; }
    } else {
        let muted = false;
        rl._writeToOutput = s => { if (!muted) rl.output.write(s); };
        const ask = q => { muted = false; rl.output.write(q); muted = true; return new Promise(r => rl.question("", r)); };
        pw = await ask("Password: ");
        rl.output.write("\n");
        const again = await ask("Repeat password: ");
        rl.output.write("\n");
        if (pw !== again) { rl.close(); throw new Error("passwords don't match"); }
    }
    rl.close();
    if (!pw || pw.length < MIN_PASSWORD) throw new Error(`password must be at least ${MIN_PASSWORD} characters`);
    return pw;
}

function userByEmail(db, email) {
    const u = db.getUserByEmail(need(email, "<email>"));
    if (!u) throw new Error(`No user ${email}`);
    return u;
}

(async () => {
    switch (cmd) {
    case "add": {
        const db = openDb(), s = scraper();
        const url = need(arg1, "<tocUrl>");
        const novel = await s.getNovel(url);
        if (novel.usingDefaultParser) throw new Error(`No WebToEpub parser for this site (${new URL(url).hostname})`);
        if (!novel.chapters.length) throw new Error(`No chapters found at ${url} (parser ${novel.parser})`);
        const row = db.addNovel(url);
        db.updateNovelMeta(row.id, novel);
        db.addChapters(row.id, novel.chapters);   // pending until fetched
        console.log(`added #${row.id}: ${novel.title} by ${novel.author} — ${novel.chapters.length} chapters (${novel.parser})`);
        console.log(`run \`node cli.js update ${row.id}\` to fetch them now, or let the worker pick it up`);
        break;
    }
    case "list": {
        const rows = openDb().listNovels();
        if (!rows.length) console.log("no novels yet — `node cli.js add <tocUrl>`");
        for (const n of rows) {
            console.log(`#${n.id} [${n.status}] ${n.title || n.toc_url} — ${n.chapters_fetched}/${n.chapters_total} chapters` +
                `${n.chapters_failing ? ` (${n.chapters_failing} failing)` : ""}` +
                `, checked ${n.last_checked_at || "never"}${n.last_error ? `\n     error: ${n.last_error}` : ""}` +
                `${n.epub_path ? `\n     epub: ${n.epub_path}` : ""}`);
        }
        break;
    }
    case "update": {
        const db = openDb(), s = scraper();
        const targets = arg1 ? [novelById(db, arg1)] : db.listNovels().filter(n => n.status === "active");
        for (const n of targets) await worker.checkNovel(db, s, n);
        break;
    }
    case "build": {
        const db = openDb();
        console.log(await worker.buildEpub(db, scraper(), novelById(db, arg1).id));
        break;
    }
    case "pause":
    case "resume": {
        const db = openDb(), n = novelById(db, arg1);
        db.setStatus(n.id, cmd === "pause" ? "paused" : "active");
        console.log(`#${n.id} ${cmd === "pause" ? "paused" : "active"}`);
        break;
    }
    case "retry": {
        const db = openDb(), n = novelById(db, arg1);
        const { changes } = db.resetChapterRetries(n.id);
        console.log(`#${n.id}: ${changes} failed chapter(s) will be retried on the next check`);
        break;
    }
    case "remove": {
        const db = openDb(), n = novelById(db, arg1);
        db.deleteNovel(n.id);
        console.log(`removed #${n.id} ${n.title || n.toc_url}${n.epub_path ? ` (kept ${n.epub_path})` : ""}`);
        break;
    }
    case "user:create": {
        const db = openDb(), email = need(arg1, "<email>");
        if (db.getUserByEmail(email)) throw new Error(`User ${email} already exists`);
        const hash = await bcrypt.hash(await readPassword(), rounds());
        const u = db.createUser({ email, name: arg2 || null, passwordHash: hash });
        logSecurity("user_created", { email: u.email });
        break;
    }
    case "user:password": {
        const db = openDb(), u = userByEmail(db, arg1);
        db.setPassword(u.id, await bcrypt.hash(await readPassword(), rounds()));
        logSecurity("password_changed", { email: u.email });
        break;
    }
    case "user:unlink-oidc": {
        const db = openDb(), u = userByEmail(db, arg1);
        db.unlinkOidc(u.id);
        logSecurity("oidc_unlinked", { email: u.email });
        break;
    }
    case "worker":
        await worker.runLoop(openDb(), scraper());
        break;
    case "parser":
        console.log(scraper().parserNameFor(need(arg1, "<url>")) || "(no site parser — would use DefaultParser)");
        break;
    case "info":
        console.log(JSON.stringify(strip(await scraper().getNovel(need(arg1, "<tocUrl>"))), null, 2));
        break;
    case "chapter": {
        const s = scraper();
        const novel = await s.getNovel(need(arg1, "<tocUrl>"));
        const n = Math.max(1, parseInt(arg2 || "1", 10));
        const c = novel.chapters[n - 1];
        if (!c) throw new Error(`Only ${novel.chapters.length} chapters found`);
        const ch = await s.getChapter(novel, c.url);
        console.error(`# ${ch.title}  (${ch.text.length} chars)  ${ch.url}`);
        if (ch.warnings.length) console.error("warnings:", ch.warnings);
        console.log(ch.html);
        break;
    }
    case "check": {
        const known = JSON.parse(fs.readFileSync(need(arg2, "<known.json>"), "utf8")).chapters || [];
        const novel = await scraper().getNovel(need(arg1, "<tocUrl>"));
        const { added, removed } = diffChapters(known, novel.chapters);
        console.log(JSON.stringify({ total: novel.chapters.length, added, removed }, null, 2));
        break;
    }
    default:
        console.error(usage());
        process.exit(2);
    }
})().catch(e => { console.error("Error:", e.message); process.exit(1); });
