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
