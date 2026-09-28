#!/usr/bin/env node
// Usage:
//   node cli.js add     <tocUrl>                 add a novel (fetches its TOC; chapters come on `update`)
//   node cli.js list                             novels with chapter counts, last check, errors
//   node cli.js update  [id]                     check one novel now (or all active ones), fetch new chapters, rebuild EPUB
//   node cli.js build   <id>                     rebuild the EPUB from stored chapters
//   node cli.js pause|resume|remove <id>         stop/start scheduled checks, or delete the novel (EPUB file is kept)
//   node cli.js retry   <id>                     reset failed chapters' attempts so the next check retries them
//   node cli.js worker                           run forever: check each novel once a day (check_interval_min, default 1440)
//   node cli.js parser  <url>                    which WebToEpub parser handles the URL
//   node cli.js info    <tocUrl>                 metadata + chapter list (JSON)
//   node cli.js chapter <tocUrl> [n]             fetch chapter n (default 1) and print cleaned HTML
//   node cli.js check   <tocUrl> <known.json>    list chapters not in known.json (a saved `info` output)
// Env: NOVEL_DB (default data/novel.db), NOVEL_LIBRARY (default library/), NOVEL_COOKIE, NOVEL_UA,
//      NOVEL_MAX_ATTEMPTS (5), NOVEL_RETRY_BASE_MIN (60: chapter retry backoff 1h, 2h, 4h, 8h)
"use strict";
const fs = require("fs");
const { createScraper } = require("./src/scraper");
const { diffChapters } = require("./src/diff");
const { openDb } = require("./src/db");
const worker = require("./src/worker");

const [cmd, arg1, arg2] = process.argv.slice(2);
const strip = n => ({ ...n, _parser: undefined });
const usage = () => fs.readFileSync(__filename, "utf8").split("\n").slice(1, 15).join("\n");

function scraper() {
    const s = createScraper({
        headers: {
            ...(process.env.NOVEL_COOKIE && { Cookie: process.env.NOVEL_COOKIE }),
            ...(process.env.NOVEL_UA && { "User-Agent": process.env.NOVEL_UA }),
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

(async () => {
    switch (cmd) {
    case "add": {
        const db = openDb(), s = scraper();
        const url = need(arg1, "<tocUrl>");
        const novel = await s.getNovel(url);
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
