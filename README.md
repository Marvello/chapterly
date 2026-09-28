# novel-harness

Self-hosted manager for the web novels I follow: add a novel by its table-of-contents URL, a
worker checks it daily and fetches only new chapters, and the EPUB is regenerated into the
**Audiobookshelf** library folder (its folder watcher picks it up). Scraping reuses
[WebToEpub](https://github.com/dteviot/WebToEpub)'s 640+ site parsers, run headless in Node (jsdom),
instead of writing our own. (FanFicFare supports updates but not freewebnovel, the main site here.)

Target: Tower homelab (Docker, next to Audiobookshelf), Node 24, public access only via
Cloudflare Tunnel + Access.

## Setup
    ./setup.sh          # clones WebToEpub into vendor-WebToEpub/ and runs npm install
    npm test            # offline tests (synthetic freewebnovel-shaped site, incl. full pipeline)

Re-run `./setup.sh` to pull upstream parser fixes.

## Novel manager (CLI)
    node cli.js add    https://freewebnovel.com/novel/<slug>   # fetch TOC, store novel + chapter list
    node cli.js list                                           # fetched/total chapters, last check, errors, EPUB path
    node cli.js update [id]                                    # check now: fetch new chapters, rebuild EPUB
    node cli.js build  <id>                                    # rebuild EPUB from stored chapters
    node cli.js pause|resume|remove <id>
    node cli.js retry  <id>                                    # retry chapters that gave up
    npm run worker                                             # run forever (see below)

- **Storage:** SQLite at `NOVEL_DB` (default `data/novel.db`), via built-in `node:sqlite` (Node 24).
  All SQL lives in `src/db.js`; migrations are numbered files in `migrations/`. Postgres later =
  rewrite `db.js`, callers unchanged.
- **Worker:** wakes every `NOVEL_TICK_MIN` (default 5) and checks each active novel whose last
  check started ≥ `check_interval_min` (default 1440 = once a day) ago, one novel at a time. New chapters are
  fetched one by one with the parser's throttle and saved as they arrive, so a crash loses nothing.
  A failed chapter stays pending and is retried with exponential backoff: after the nth failure it
  waits `NOVEL_RETRY_BASE_MIN × 2^(n-1)` (default 1h, 2h, 4h, 8h); after `NOVEL_MAX_ATTEMPTS` (5)
  it stops and `list` shows the error. `node cli.js retry <id>` resets it. Retries only happen
  during a check, so with daily checks a failing chapter is retried at most once a day. (Within a single check,
  WebToEpub's HttpClient already retries 429/5xx after 15/30/60/120 s.)
- **EPUB:** packed by WebToEpub's own `EpubPacker` (EPUB 3 + toc.ncx, cover embedded), written to
  `NOVEL_LIBRARY/<Author>/<Title>/<Title>.epub` (default `library/`) via temp file + rename. The
  path is fixed on first build, so Audiobookshelf keeps it as one item.
- `node:sqlite` prints an ExperimentalWarning on Node 24; `npm run worker` hides it, or set
  `NODE_OPTIONS=--disable-warning=ExperimentalWarning`.

## CLI (scraper debugging)
    node cli.js parser  https://freewebnovel.com/novel/<slug>
    node cli.js info    https://freewebnovel.com/novel/<slug> > known.json
    node cli.js chapter https://freewebnovel.com/novel/<slug> 1
    node cli.js check   https://freewebnovel.com/novel/<slug> known.json   # new chapters only

Requests go through `src/browserFetch.js` (got-scraping: Chrome-like TLS + headers), which passes
Cloudflare's bot check on freewebnovel without cookies. If a site still blocks, set
`NOVEL_COOKIE="cf_clearance=..."` plus `NOVEL_UA` (that browser's exact User-Agent).

## API
    const { createScraper } = require("./src/scraper");
    const { diffChapters } = require("./src/diff");
    const s = createScraper();                     // ~0.5s, load once per worker
    const novel = await s.getNovel(tocUrl);        // {title, author, cover, chapters:[{index,url,title}], ...}
    const ch = await s.getChapter(novel, url);     // {title, html, text, warnings}; honours parser throttle
    const { added } = diffChapters(storedChapters, novel.chapters);

## How it works
- `src/loader.js` reads `popup.html` to get WebToEpub's script order, loads every core + parser
  file into one jsdom VM context, and stubs the extension-only parts (chrome.*, progress bar,
  chapter table UI, i18n from `_locales/en`). Node supplies fetch, TextDecoder, etc.
- zip.js and DOMPurify (WebToEpub's npm deps, normally copied into `plugin/` by its postinstall) are
  loaded from this project's `node_modules/`.
- `src/scraper.js` mirrors the extension flow: pick parser by hostname -> `getChapterUrls`
  (incl. paginated TOCs) -> `fetchChapter` -> `convertRawDomToContent` (the same cleanup the
  EPUB gets). Images are left as absolute URLs for the EPUB builder to download.

## Limits
- Sites that render chapters with client-side JS, or sit behind interactive Cloudflare challenges (Turnstile),
  return empty/blocked HTML here too. Those need a Playwright fallback (next milestone).
- `innerText` is approximated by `textContent` (jsdom has no layout); a few parsers that
  depend on rendered line breaks may produce slightly different whitespace.
- WebToEpub is GPLv3: fine for personal use; if you distribute this, it must be GPLv3 too.

## Rules
- Keep `vendor-WebToEpub/` unmodified; `./setup.sh` pulls upstream parser fixes. Patches go in
  `src/loader.js` (stubs/polyfills), never in vendor files.
- Be polite to sites: parser throttle, one request per site at a time, daily checks. Prefer a
  novel's original translator site over aggregators when WebToEpub supports it.

## Next
1. **Deploy to Tower:** docker-compose (Node 24), SQLite on a volume, Audiobookshelf library mounted
   read-write for the worker.
2. **Web UI:** add by URL with a preview (title, chapter count), library list with errors and
   last check, "check now", pause/resume/delete. Behind Cloudflare Access.
3. **Playwright fallback** per novel (`fetch_mode: http|browser`) for JS-rendered sites or
   interactive Cloudflare challenges.
