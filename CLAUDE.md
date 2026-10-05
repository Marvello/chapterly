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
