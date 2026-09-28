# Milestone 2 — pipeline end-to-end (DB + worker + EPUB), CLI-driven

Decisions (2026-09-28): SQLite now, keep Postgres possible · in-process worker loop, no Redis ·
no UI / docker this round.

## Design
- **DB — `src/db.js` + `migrations/*.sql`**
  - `node:sqlite` (built into Node; project runs on **Node 24**, set in `engines`). DB file from `NOVEL_DB`, default `data/novel.db`.
  - Postgres-ready: every SQL statement lives in `db.js` (the rest of the code calls functions like
    `upsertNovel`, `insertChapter`); portable SQL only (TEXT/INTEGER, ISO-8601 text timestamps,
    `ON CONFLICT … DO UPDATE`); numbered `.sql` migrations + `schema_migrations` ledger, as in
    common-tech `postgres-client.md`. Moving to Postgres = swap `db.js` internals, same functions.
  - `novels`: id, toc_url UNIQUE, parser, title, author, cover_url, description,
    status (active/paused/completed), check_interval_min, last_checked_at, last_success_at,
    last_error, epub_path, created_at.
  - `chapters`: id, novel_id, idx, url, title, html, fetched_at, error; UNIQUE(novel_id, url).
- **Worker — `src/worker.js`**
  - `checkNovel(novel)`: `getNovel` → update metadata → `diffChapters` against stored → fetch the added
    ones one by one (parser throttle), **save each chapter as soon as it arrives** → if anything new,
    rebuild the EPUB. Errors go to `novels.last_error`; one failing chapter doesn't stop the rest.
  - `runLoop()`: every `NOVEL_TICK_MIN` (default 60), check due novels one at a time. Checking novels
    one at a time also means only one request per domain at a time.
  - HTTP 429/503 backoff: WebToEpub's HttpClient already retries (15/30/60/120 s); on final failure,
    record the error and move on.
- **EPUB — `src/epub.js`**
  - Reuse WebToEpub's `EpubPacker` + `EpubItemSupplier` + `ChapterEpubItem` (already loaded in the VM)
    over stored chapter HTML → same output as the extension. EPUB 3 (with toc.ncx kept for older readers).
  - Write to `<NOVEL_LIBRARY>/<Author>/<Title>/<Title>.epub`: write a temp file, then rename, so
    Audiobookshelf always sees one complete file at the same path.
  - Cover image embedded; inline chapter images left as remote URLs (freewebnovel has none).
  - Fallback if the packer won't run headless: pack with zip.js (also already loaded).
- **CLI — `cli.js` additions:** `add <tocUrl>` · `list` · `update [id]` (check one or all now) ·
  `build <id>` (rebuild EPUB) · `pause|resume <id>` · `worker` (start the loop). Existing
  parser/info/chapter/check commands stay.

## Tasks
- [x] 1. Spike: build an EPUB with WebToEpub's packer from 2 fake chapters in the VM (decides reuse vs zip.js)
- [x] 2. `migrations/001_init.sql` + `src/db.js` (migration runner + query functions)
- [x] 3. `src/epub.js` (pack + temp-file/rename write)
- [x] 4. `src/worker.js` (`checkNovel`, `runLoop`)
- [x] 5. CLI commands
- [x] 6. Offline test `test/pipeline.test.js`: add → update → EPUB exists and has N chapters →
      add chapter to mock site → update fetches only the new one → EPUB rebuilt at the same path
- [x] 7. Live check against a short freewebnovel novel; open the EPUB (validate with epubcheck if available)
- [x] 8. Update README + handover; review section below

## Out of scope (next round)
Web UI · docker-compose / Tower deploy · Playwright fallback · Postgres implementation.

## Review
- Plan held, with a few changes:
  - The EPUB builder lives in `scraper.buildEpub` (it needs the VM), and `worker.buildEpub` does
    the file writing. No separate `src/epub.js`.
  - Pending-row design: `add` / `diffChapters` insert chapters with `html NULL`, and a check
    fetches every pending row. Crash resume and retrying failed chapters come for free.
  - The worker ticks every 5 min and novels are due every 60 min. A check's start time counts as
    "last checked", so a 60-min tick would have drifted to a 2-hour cycle.
- The spike found 4 headless gaps, all fixed in the loader: zip.js/DOMPurify weren't loaded;
  web streams were missing; jsdom's Blob had no `arrayBuffer`; image `onload` never fired (hang).
- Verified:
  - `npm test` passes (diff, harness, pipeline). The pipeline test covers add → full fetch + EPUB
    → no-op → new + broken chapter → retry → scheduling. Mutation check: disabling the EPUB rebuild
    fails the test.
  - Live: a 79-chapter novel, 0 failures, epubcheck 5.4 clean, real cover embedded; the re-check
    was a no-op (3 s); the worker loop starts and skips novels that aren't due.
- Known ceilings (fine for single-user):
  - A CLI `update` running alongside the worker can double-fetch the same novel.
  - Chapters dropped from the TOC stay in the EPUB.
  - SQLite reuses the highest id after a delete.

## Follow-up (2026-09-28): chapter retry limit + exponential backoff
- [x] Migration 002: `chapters.attempts`, `chapters.retry_at`
- [x] Backoff `NOVEL_RETRY_BASE_MIN × 2^(n-1)` (1h, 2h, 4h, 8h); give up after `NOVEL_MAX_ATTEMPTS` (5)
- [x] `list` shows failing count; gave-up chapters stay in `last_error`; `cli.js retry <id>` resets
- [x] Test: backoff blocks early retry, gives up at the limit, no attempts after that, reset works,
      delays double. Mutation (drop the retry_at check) fails the test. Migration upgraded the existing live DB.

## Follow-up (2026-09-28): daily checks by default
- [x] `check_interval_min` default 60 → 1440 (edited 001 in place: nothing deployed yet)
- [x] handover.md folded into README (goal, rules, next) and removed; known.json removed; git init

## Web UI — end-to-end results (2026-09-28, Docker stack, Chrome)
Plan: `docs/superpowers/plans/2026-09-28-web-ui.md` · GIF: `novel-web-e2e.gif` (Downloads, 50 frames)
1. `/` → redirect to `/login`, password form only (no OIDC env) — pass
2. Wrong password → "Sign-in failed."; 5th failure → `account_locked`; right password while locked refused
   (`reason: locked`); after 1 min signs in — pass
3. Add freewebnovel URL → "fetching info…" → title/cover → 79/79, "+79 new" (worker in container) — pass
4. Same URL with spaces + upper-case host → opens existing novel, no duplicate — pass
5. example.com → first run showed DefaultParser turning its links into a 1-chapter junk "novel"; after the
   final review, sites without a dedicated parser are rejected ("No WebToEpub parser for this site", tested)
6. Check now → "checking…" → active; Pause hides Check now; Resume; interval persists — pass
7. Chapter forced to gave-up → Problems panel "(5/5, gave up)" → Retry → refetched, panel gone — pass
8. `cli.js user:password` → open browser logged out on next navigation, `stale_session_rejected` — pass
9. Delete → "Really delete? (EPUB file is kept)" → gone from library, EPUB still on disk — pass
10. Security headers present; forged server action (real action id, session cookie) from
    `Origin: https://evil.example` → 500, no change; same request same-origin → applied — pass
Phone width (root narrowed to 375 px; Chrome can't size the window that small): no element overflows — pass

Bugs found and fixed during e2e (each with a failing test first):
- DefaultParser crashed: `DefaultParserSiteSettings` lives in DefaultParserUI.js, which the loader skipped
- Chapters containing links crashed (`webPage.nextPrevChapters` missing) — latent for every parser
- 0-chapter TOC was a silent "0/0 active" novel → now an error
- (final review) DefaultParser sites rejected as unsupported; a deleted/paused novel stops being fetched mid-check
- Interval select showed the old value after saving (React 19 form reset) → `key={minutes}`
- SQLite "database disk image is malformed" when the Mac host read `./data` while containers wrote →
  DB now in a named volume by default (WAL needs one kernel)

## Web UI — security.md review (2026-09-28)
| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | HSTS | Pass | `web/next.config.ts` headers; `curl -I` shows HSTS + nosniff + Referrer-Policy + `frame-ancestors 'none'` |
| 3 | Reset sessions on password change | Pass | `users.session_version` bumped by `db.setPassword`; `lib/session.ts` checkSession in jwt callback; e2e step 8 |
| 4 | Expire reset links | N/A | no password-reset flow (password changed via CLI) |
| 5 | No user enumeration | Pass | one "Sign-in failed." for unknown/wrong/locked; dummy-hash compare (`lib/passwordLogin.ts`); identical 302 for unknown vs wrong (curl) |
| 6 | Upload whitelist | N/A | no uploads |
| 7 | Payment webhooks | N/A | no payments |
| 8 | Server-side prices | N/A | no payments |
| 9 | Prompt injection | N/A | no AI features |
| 10 | Cap AI usage | N/A | no AI features |
| 11 | Request size | Pass | `serverActions.bodySizeLimit: "64kb"`; URL ≤ 2048 (`lib/validate.ts`) |
| 12 | Rate-limit password reset | N/A | no reset flow; login itself is rate-limited (#17) |
| 13 | Validate/escape input | Pass | `parseNovelUrl`/`parseInterval`/`parseId`; only `?` params in `src/db.js`; React escaping; chapter HTML never rendered |
| 14 | CORS | Pass | no CORS headers; server actions reject foreign Origin (e2e step 10) |
| 15 | Directory listing | Pass | Next.js serves no listings; data volume and library are not served |
| 16 | Default/admin routes | Pass | no seeded user (`cli.js user:create`); public: `/login`, `/api/auth/*`, `/api/health` ("ok" only), `/robots.txt` |
| 17 | Lockout | Pass | 5 fails → 1, 2, 4 … 60 min (`lib/lockout.ts`, tests, e2e step 2); 10/min per IP (`lib/rateLimit.ts`). Note: IP from `cf-connecting-ip`/`x-forwarded-for` — trustworthy only because the port is bound to 127.0.0.1 behind the tunnel |
| 18 | Security events | Pass | JSON lines: login_success/login_failed/account_locked/login_rate_limited/stale_session_rejected/oidc_rejected/oidc_bound/user_created/password_changed/oidc_unlinked; no passwords (test) |
| 19 | Cookie flags | Pass (local) / verify on Tower | local `authjs.session-token`: HttpOnly; SameSite=Lax; Secure keyed to https `AUTH_URL` (Tower) |
| 20 | DB permissions | Partial | SQLite has no roles; DB in a named volume mounted only by worker + web, owned by uid 1000 |
