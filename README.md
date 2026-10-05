# <img src="web/app/icon.svg" width="32" height="32" alt="" align="top"> Chapterly

Self-hosted manager for the web novels I follow: add a novel by its table-of-contents URL, a
worker checks it daily and fetches only new chapters, and the EPUB is regenerated into the
**Audiobookshelf** library folder (its folder watcher picks it up). Scraping reuses
[WebToEpub](https://github.com/dteviot/WebToEpub)'s 640+ site parsers, run headless in Node (jsdom),
instead of writing our own.

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
listens on all host interfaces (see Deploy). Every CLI command below also works via `docker compose exec worker node cli.js …`.

### Reader (phone)
Open `/read` (or "Reader" in the header) and use Chrome's "Install app" to put it on the home screen.
It shows the chapters straight from the DB. Progress is saved per novel and only moves forward on its own:
opening an earlier chapter shows "Your progress is at …" with **Set progress here** / **Go to it**. The
current chapter plus the next 50 unread of every novel you're reading are kept on the phone for offline
reading; "Download unread" on a novel keeps all of them. EPUB building for Audiobookshelf can be switched
off per novel (novel page, or `node cli.js epub <id> on|off`).

### Login: password and/or OIDC
Controlled by env (see `.env.example`). With no `AUTH_OIDC_*` set, only the password form is shown.
Set all three `AUTH_OIDC_*` (issuer, client id, secret) to add a "Sign in with <AUTH_OIDC_NAME>" button
(password stays as a fallback unless `AUTH_PASSWORD_LOGIN=false`). Partial OIDC config, or
`AUTH_PASSWORD_LOGIN=false` without OIDC, stops the web container at startup. Provider setup:
1. Create a *confidential* OAuth2/OpenID client with redirect URI
   `https://<your host>/api/auth/callback/oidc`, RS256 signing, scopes `openid email profile`.
   The provider must return `email_verified: true` for your user (the app refuses unverified emails).
2. Use the provider's issuer URL for `AUTH_OIDC_ISSUER`, and restrict the client to your own user/group.
3. First sign-in links the OIDC identity to the account with the same email; afterwards only that
   identity is accepted. `cli.js user:unlink-oidc <email>` resets the link.

## Deploy on a server
Keep a git checkout of this repo on the server, next to its `.env` (never committed). To update, push
from your machine, then pull and rebuild on the server:

    git push origin main
    ssh <server> 'cd <chapterly dir> && git pull --ff-only && docker compose up -d --build'

In the server's `.env`, point `CHAPTERLY_LIBRARY_DIR` at the Audiobookshelf library, `PUID`/`PGID` at
its owner, and optionally set `CHAPTERLY_DATA_DIR` (a host path), `CHAPTERLY_WEB_PORT` and `AUTH_URL`
(the URL you open the UI at). CLI commands: `docker exec -it chapterly-worker node cli.js …`.
The web port listens on all of the host's interfaces, so it's reachable over the LAN or a private VPN.
Keep it behind a firewall and never port-forward it to the internet; for public access put an
authenticating tunnel / reverse proxy in front, with `AUTH_URL` set to that https URL. For localhost
only, bind it as `127.0.0.1:${CHAPTERLY_WEB_PORT:-3000}:3000` in `compose.yaml`.

A change to how EPUBs are packed only reaches existing books when they are next rebuilt (a new chapter
arrives); to apply it now: `for i in $(seq 1 <last id>); do docker exec chapterly-worker node cli.js build $i; done`.

## Novel manager (CLI)
    node cli.js add    https://freewebnovel.com/novel/<slug>   # fetch TOC, store novel + chapter list
    node cli.js list                                           # fetched/total chapters, last check, errors, EPUB path
    node cli.js update [id]                                    # check now: fetch new chapters, rebuild EPUB
    node cli.js build  <id>                                    # rebuild EPUB from stored chapters
    node cli.js pause|resume|remove <id>
    node cli.js retry  <id>                                    # retry chapters that gave up
    node cli.js epub   <id> on|off                             # EPUB / Audiobookshelf rescan for this novel
    npm run worker                                             # run forever (from worker/)

- **Storage:** SQLite at `CHAPTERLY_DB` (default `data/chapterly.db` at the repo root), via built-in `node:sqlite` (Node 24).
  All SQL lives in `shared/db.js`; migrations are numbered files in `shared/migrations/`. Postgres later =
  rewrite `db.js`, callers unchanged.
- **Worker:** wakes every `CHAPTERLY_TICK_MIN` (default 1) and checks each active novel that was asked to "check now" or whose last
  check started ≥ `check_interval_min` (default 1440 = once a day) ago, one novel at a time. New chapters are
  fetched one by one with the parser's throttle and saved as they arrive, so a crash loses nothing.
  A failed chapter stays pending and is retried with exponential backoff: after the nth failure it
  waits `CHAPTERLY_RETRY_BASE_MIN × 2^(n-1)` (default 1h, 2h, 4h, 8h); after `CHAPTERLY_MAX_ATTEMPTS` (5)
  it stops and `list` shows the error. `node cli.js retry <id>` resets it. A novel is checked as soon as
  one of its chapters' retry is due, so the backoff applies even with daily checks. (Within a single check,
  WebToEpub's HttpClient already retries 429/5xx after 15/30/60/120 s.) Each HTTP request times out after
  `CHAPTERLY_FETCH_TIMEOUT_SEC` (default 120); a timeout counts as a failed attempt. A check that fails
  as a whole (e.g. the novel's page times out) is retried on the same backoff instead of a full interval
  later, so a site that's down at the same hour every day doesn't block the novel forever.
- **Restarts:** on startup the worker resumes any check it was stopped in the middle of (restart,
  redeploy, crash) right away instead of after the novel's interval, fetching only the chapters it hadn't
  saved. "Check now" requests (these, or the UI button) run before routine scheduled checks.
- **Story status:** each novel is ongoing / completed / dropped — read from the site's `og:novel:status`
  tag on every check, unless you set it yourself (novel page or `cli.js series <id> <status>`), after
  which the site never overrides it. Completed + every chapter fetched → no more scheduled checks
  (only "Check now"); dropped (author or site abandoned it) → checked at most weekly.
- **Audiobookshelf rescan (optional):** with `CHAPTERLY_ABS_URL`, `CHAPTERLY_ABS_TOKEN` (an ABS API key of
  an **admin** user; ABS → Settings → API Keys) and `CHAPTERLY_ABS_LIBRARY` (library name or id, e.g.
  `Ebooks`), the worker calls ABS's `POST /api/libraries/:id/scan` right after an EPUB changes, instead of
  waiting for ABS's nightly scan. Best effort: failures are logged, the check still succeeds. A partial
  config stops the worker at startup. For ABS published on the same host, use
  `CHAPTERLY_ABS_URL=http://host.docker.internal:<ABS port>`.
- **EPUB:** packed by WebToEpub's own `EpubPacker` (EPUB 3 + toc.ncx, cover embedded), written to
  `CHAPTERLY_LIBRARY/<Author>/<Title>/<Title>.epub` (default `library/` at the repo root) via temp file + rename. The
  path is fixed on first build, so Audiobookshelf keeps it as one item. Chapters are rendered one at a
  time with an event-loop yield every 50, so memory stays flat for long novels (4800 chapters ≈ 750 MB
  peak; packing them in one synchronous pass needed > 4 GB, because jsdom WeakRefs keep each sanitized
  temp document alive until the task ends). A site heading that repeats the chapter title (`<h2>` with the
  same "Chapter N" right under WebToEpub's `<h1>`, as on freewebnovel) is dropped at build time.
- **Library (web UI):** Overview / Table / Posters (remembered in a cookie), plus search (title or
  author), a filter (new chapters, ongoing / completed / dropped, errors, paused) and a sort (new first,
  title, recently updated, recently added, most chapters). Search, filter and sort live in the URL
  (`?q=&filter=&sort=`), so back/forward and bookmarks keep them.
- **"+N new" badge (web UI):** chapters fetched in the last 24 h. It expires on its own; rebuilding an
  EPUB doesn't reset it.
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
  page can trigger that. OIDC login, if configured, stays usable while it's locked.
- Sites that render chapters with client-side JS, or sit behind interactive Cloudflare challenges (Turnstile),
  return empty/blocked HTML here too. Those need a Playwright fallback (next milestone).
- `innerText` is approximated by `textContent` (jsdom has no layout); a few parsers that
  depend on rendered line breaks may produce slightly different whitespace.
- License: GPL-3.0-or-later (see `LICENSE`), because the worker runs WebToEpub (GPL-3.0-only) in-process.
  WebToEpub isn't in this repo (fetched at setup / build); a published Docker image does include it,
  with its own `LICENSE.md`.

## Rules
- Keep `worker/vendor-WebToEpub/` unmodified; `worker/setup.sh` pulls upstream parser fixes. Patches go in
  `worker/src/loader.js` (stubs/polyfills), never in vendor files.
- Be polite to sites: parser throttle, one request per site at a time, daily checks. Prefer a
  novel's original translator site over aggregators when WebToEpub supports it.

## Next
1. **Crash-loop guard:** a check that crashes the worker is resumed on every restart; stop resuming the
   same novel after a few consecutive crashes.
2. **Library pagination** (a couple of hundred novels+). The library query counts chapters per novel on
   every load, so at that size also store the counts on the novel row; pagination alone won't fix that.
3. **Playwright fallback** per novel (`fetch_mode: http|browser`) for JS-rendered sites or
   interactive Cloudflare challenges.
