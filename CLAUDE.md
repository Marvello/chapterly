# CLAUDE.md

Chapterly: self-hosted web-novel → EPUB manager. Worker scrapes with WebToEpub's parsers (headless, jsdom)
and writes EPUBs into the Audiobookshelf library; the Next.js web UI only reads the DB and records intents.
README.md has the full setup, env vars and CLI.

## Layout / commands
- `shared/db.js` is the only module with SQL; schema changes = a new numbered file in `shared/migrations/`.
  `web/lib/db.ts` holds the TypeScript row types — keep them in sync with new columns.
- `worker/` scraper + scheduler + CLI (`node cli.js …`); `web/` Next.js UI (see `web/AGENTS.md`).
- `npm test` at the root runs worker tests (offline mock site, full pipeline) + web vitest.
  Web type-check: `cd web && npx tsc --noEmit`.

## Scheduling and retries (worker/src/worker.js)
- Worker ticks every `CHAPTERLY_TICK_MIN`; `isDue` decides. A novel is due on "check now", its interval
  (`check_interval_min`, default daily), a failed chapter's `retry_at`, or a failed check's `check_retry_at`.
- Backoff for both chapters and whole checks: `RETRY_BASE_MIN × 2^(n-1)` (1h, 2h, 4h…). Chapters give up
  after `CHAPTERLY_MAX_ATTEMPTS`; whole checks never give up (the interval takes over once the wait is longer).
- `web/lib/view.ts nextCheckAt` mirrors `isDue` for display — change both together.
- Per-request timeout `CHAPTERLY_FETCH_TIMEOUT_SEC` (default 120; got-scraping's own default is 60).

## Deploy
Runs on tower (homeserver); deploy steps and paths are in `../common-tech/memory/homeserver/app-chapterly.md`.

## Reader (web/app/read, web/lib/reader)
- `/read` is one client-rendered page; views switch by query string via `history.pushState` so the service
  worker (`public/sw.js`) can cache it as one shell. Chapters live in IndexedDB (`lib/reader/idb.ts`), not
  the SW cache. Logic is pure and tested: `progress.ts` (forward-only rules; "behind" = an earlier chapter),
  `plan.ts` (what to keep offline), `scroll.ts`, `sync.ts` (outbox flush + downloads, in-memory store tests),
  `settings.ts` (useSyncExternalStore store; server renders defaults).
- API: `app/api/reader/*` are thin wrappers over `lib/reader/api.ts`. Signed-out `/api/*` gets 401 JSON
  (`lib/proxyRules.ts`). `PUT /progress` requires JSON + same Origin (CSRF).
- Chapter HTML is sanitized with DOMPurify: worker before saving (`worker/src/sanitize.js`), web on first
  read for older rows (`web/lib/sanitize.ts`, `chapters.html_clean`). The two copies have a parity test.
- Per-novel `novels.epub_enabled` gates the EPUB build and the Audiobookshelf rescan.
- Browser-automation testing: the automation tab is hidden, so IntersectionObserver/timers only run while it
  renders — drive it with real scroll input + screenshots.
