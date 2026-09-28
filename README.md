# Chapterly

Self-hosted manager for the web novels I follow: add a novel by its table-of-contents URL, a
worker checks it daily and fetches only new chapters, and the EPUB is regenerated into the
**Audiobookshelf** library folder (its folder watcher picks it up). Scraping reuses
[WebToEpub](https://github.com/dteviot/WebToEpub)'s 640+ site parsers, run headless in Node (jsdom),
instead of writing our own. (FanFicFare supports updates but not freewebnovel, the main site here.)

Target: Tower homelab (Docker, next to Audiobookshelf), Node 24, public access only via
Cloudflare Tunnel + Access.

## Layout
    shared/     db.js (the only module with SQL) + migrations/ — used by both worker and web
    worker/     scraper + scheduler + CLI (cli.js, src/, test/, vendor-WebToEpub/)
    web/        Next.js UI (reads the DB, records intents; never scrapes)

## Setup
    npm run setup       # worker/setup.sh (clones WebToEpub into worker/vendor-WebToEpub/, npm install) + web install
    npm test            # worker tests (synthetic freewebnovel-shaped site, incl. full pipeline) + web tests

Re-run `worker/setup.sh` to pull upstream parser fixes. CLI commands below run from `worker/`
(`cd worker && node cli.js …`) or in Docker (`docker compose exec worker node cli.js …`).

## Run with Docker
    cp .env.example .env && sed -i '' "s|^AUTH_SECRET=.*|AUTH_SECRET=$(openssl rand -base64 32)|" .env
    docker compose up -d --build                                  # worker + web UI on http://localhost:3000
    docker compose exec worker node cli.js user:create you@example.com "Your Name"   # prompts for the password
    docker compose logs -f worker web
    docker compose build --no-cache && docker compose up -d       # pull WebToEpub parser fixes

The web UI never scrapes: add / check now / retry / interval / pause / delete are written to the DB and
the worker picks them up within `CHAPTERLY_TICK_MIN` (1 min). The SQLite DB lives in the `chapterly-data`
Docker volume (shared by both containers) and the EPUBs in `./library`. Override with `CHAPTERLY_DATA_DIR`,
`CHAPTERLY_LIBRARY_DIR` (point this at the Audiobookshelf library) and `PUID`/`PGID` (the user that owns
that library, default 1000) in `.env`. **Don't open the DB from the host while the containers run on
Docker Desktop** (SQLite WAL across the Mac/VM boundary can corrupt reads); use
`docker compose exec worker node cli.js list` instead. On a Linux host a host path for `CHAPTERLY_DATA_DIR`
is fine. Change the password with `cli.js user:password <email>` (logs out every session). The web port
is bound to 127.0.0.1 only. Every CLI command below also works via `docker compose exec worker node cli.js …`.

### Login: password locally, authentik on Tower
Controlled by env (see `.env.example`). With no `AUTH_OIDC_*` set, only the password form is shown.
On Tower set all three `AUTH_OIDC_*` to show "Sign in with authentik" (password stays as a fallback
unless `AUTH_PASSWORD_LOGIN=false`). Partial OIDC config, or `AUTH_PASSWORD_LOGIN=false` without OIDC,
stops the web container at startup. authentik setup:
1. Applications → Providers → **OAuth2/OpenID Provider**: client type *Confidential*, redirect URI
   `https://<novel host>/api/auth/callback/oidc`, signing key set (RS256), scopes `openid email profile`.
   The `email` scope mapping must return `email_verified: true` for your user (the app refuses unverified emails).
2. Applications → **Application** "chapterly" using that provider; slug `chapterly` → issuer
   `https://auth.<domain>/application/o/chapterly/`. Bind it to your user/group only.
3. First sign-in links your authentik identity to the account with the same email; afterwards only that
   identity is accepted. `cli.js user:unlink-oidc <email>` resets the link.

## Novel manager (CLI)
    node cli.js add    https://freewebnovel.com/novel/<slug>   # fetch TOC, store novel + chapter list
    node cli.js list                                           # fetched/total chapters, last check, errors, EPUB path
    node cli.js update [id]                                    # check now: fetch new chapters, rebuild EPUB
    node cli.js build  <id>                                    # rebuild EPUB from stored chapters
    node cli.js pause|resume|remove <id>
    node cli.js retry  <id>                                    # retry chapters that gave up
    npm run worker                                             # run forever (from worker/)

- **Storage:** SQLite at `CHAPTERLY_DB` (default `data/chapterly.db` at the repo root), via built-in `node:sqlite` (Node 24).
  All SQL lives in `shared/db.js`; migrations are numbered files in `shared/migrations/`. Postgres later =
  rewrite `db.js`, callers unchanged.
- **Worker:** wakes every `CHAPTERLY_TICK_MIN` (default 1) and checks each active novel that was asked to "check now" or whose last
  check started ≥ `check_interval_min` (default 1440 = once a day) ago, one novel at a time. New chapters are
  fetched one by one with the parser's throttle and saved as they arrive, so a crash loses nothing.
  A failed chapter stays pending and is retried with exponential backoff: after the nth failure it
  waits `CHAPTERLY_RETRY_BASE_MIN × 2^(n-1)` (default 1h, 2h, 4h, 8h); after `CHAPTERLY_MAX_ATTEMPTS` (5)
  it stops and `list` shows the error. `node cli.js retry <id>` resets it. Retries only happen
  during a check, so with daily checks a failing chapter is retried at most once a day. (Within a single check,
  WebToEpub's HttpClient already retries 429/5xx after 15/30/60/120 s.)
- **EPUB:** packed by WebToEpub's own `EpubPacker` (EPUB 3 + toc.ncx, cover embedded), written to
  `CHAPTERLY_LIBRARY/<Author>/<Title>/<Title>.epub` (default `library/` at the repo root) via temp file + rename. The
  path is fixed on first build, so Audiobookshelf keeps it as one item.
- `node:sqlite` prints an ExperimentalWarning on Node 24; `npm --prefix worker run worker` hides it, or set
  `NODE_OPTIONS=--disable-warning=ExperimentalWarning`.

## CLI (scraper debugging)
    node cli.js parser  https://freewebnovel.com/novel/<slug>
    node cli.js info    https://freewebnovel.com/novel/<slug> > known.json
    node cli.js chapter https://freewebnovel.com/novel/<slug> 1
    node cli.js check   https://freewebnovel.com/novel/<slug> known.json   # new chapters only

Requests go through `worker/src/browserFetch.js` (got-scraping: Chrome-like TLS + headers), which passes
Cloudflare's bot check on freewebnovel without cookies. If a site still blocks, set
`CHAPTERLY_COOKIE="cf_clearance=..."` plus `CHAPTERLY_UA` (that browser's exact User-Agent).

## API
    const { createScraper } = require("./worker/src/scraper");
    const { diffChapters } = require("./worker/src/diff");
    const s = createScraper();                     // ~0.5s, load once per worker
    const novel = await s.getNovel(tocUrl);        // {title, author, cover, chapters:[{index,url,title}], ...}
    const ch = await s.getChapter(novel, url);     // {title, html, text, warnings}; honours parser throttle
    const { added } = diffChapters(storedChapters, novel.chapters);

## How it works
- `worker/src/loader.js` reads `popup.html` to get WebToEpub's script order, loads every core + parser
  file into one jsdom VM context, and stubs the extension-only parts (chrome.*, progress bar,
  chapter table UI, i18n from `_locales/en`). Node supplies fetch, TextDecoder, etc.
- zip.js and DOMPurify (WebToEpub's npm deps, normally copied into `plugin/` by its postinstall) are
  loaded from this project's `node_modules/`.
- `worker/src/scraper.js` mirrors the extension flow: pick parser by hostname -> `getChapterUrls`
  (incl. paginated TOCs) -> `fetchChapter` -> `convertRawDomToContent` (the same cleanup the
  EPUB gets). Images are left as absolute URLs for the EPUB builder to download.

## Limits
- Only sites with a dedicated WebToEpub parser are supported. Other sites would fall back to
  WebToEpub's DefaultParser, which needs per-site CSS configured in the extension's UI; headless it
  would turn any page's links into junk chapters, so they are rejected ("No WebToEpub parser for this site").
  The worker publishes the ~636 supported hostnames to the DB at startup, so the web Add form rejects
  other sites instantly. The ~25 sites WebToEpub matches by URL/page rules instead of hostname can
  only be added with `cli.js add`.
- Password login locks for up to 60 min after repeated failures, and anyone who can reach the login
  page can trigger that. On Tower, authentik (OIDC) stays usable while it's locked.
- Sites that render chapters with client-side JS, or sit behind interactive Cloudflare challenges (Turnstile),
  return empty/blocked HTML here too. Those need a Playwright fallback (next milestone).
- `innerText` is approximated by `textContent` (jsdom has no layout); a few parsers that
  depend on rendered line breaks may produce slightly different whitespace.
- WebToEpub is GPLv3: fine for personal use; if you distribute this, it must be GPLv3 too.

## Rules
- Keep `worker/vendor-WebToEpub/` unmodified; `worker/setup.sh` pulls upstream parser fixes. Patches go in
  `worker/src/loader.js` (stubs/polyfills), never in vendor files.
- Be polite to sites: parser throttle, one request per site at a time, daily checks. Prefer a
  novel's original translator site over aggregators when WebToEpub supports it.

## Next
1. **Deploy to Tower:** same `compose.yaml` (verified locally), with `.env` pointing
   `CHAPTERLY_LIBRARY_DIR` at the Audiobookshelf library and `PUID`/`PGID` at its owner.
2. **Tower web deploy:** `web` behind Cloudflare Tunnel + Access, with authentik OIDC verified live.
3. **Playwright fallback** per novel (`fetch_mode: http|browser`) for JS-rendered sites or
   interactive Cloudflare challenges.
