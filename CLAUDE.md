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
- Dependency holds (2026-10-05): `@zip.js/zip.js` stays `~2.7` (WebToEpub pins it; 2.23 drops
  `dist/zip-no-worker.min.js`); eslint 9 (eslint-config-next's eslint-plugin-react crashes on 10); TypeScript 6
  (typescript-eslint supports <6.1). `braces` advisory (lint-only, via eslint-config-next) has no patched release.

## Scheduling and retries (worker/src/worker.js)
- Worker ticks every `CHAPTERLY_TICK_MIN`; `isDue` decides. A novel is due on "check now", its interval
  (`check_interval_min`, default daily), a failed chapter's `retry_at`, or a failed check's `check_retry_at`.
  While `check_retry_at` is pending, chapter retries wait for it (site down → no TOC fetch every tick).
- Backoff for both chapters and whole checks: `RETRY_BASE_MIN × 2^(n-1)` (1h, 2h, 4h…), capped at 7 days.
  Chapters give up after `CHAPTERLY_MAX_ATTEMPTS` (retry_at cleared); whole checks never give up (the interval
  takes over once the wait is longer). An interrupted check (worker stopped mid-check) counts as a failed check:
  resumed at once the first time, backed off if it's interrupted again.
- `web/lib/view.ts nextCheckAt` mirrors `isDue` for display — change both together.
- Heartbeat: `worker_status.seen_at`, stamped every tick and per chapter; the novel page warns when it's older
  than 3 ticks (min 10 min; web reads `CHAPTERLY_TICK_MIN` too, so set it on both if you change it).
- Per-request timeout `CHAPTERLY_FETCH_TIMEOUT_SEC` (default 120; got-scraping's own default is 60).

## Deploy
Runs on the turing k3s cluster (homeserver) from the CI-built ghcr images; worker + web share one pod and one
SQLite volume. Deploy/update steps: `../common-tech/memory/homeserver/app-chapterly.md`.
- CI (`.github/workflows/image.yml`) tags each image `latest` + `sha-<short commit>`. The cluster runs `:latest`
  and updates by `rollout restart`; to roll back, point the deployment at a known-good `:sha-…` tag.
- WebToEpub is pinned ONCE, `ARG WEBTOEPUB_REF` in `worker/Dockerfile`; `worker/setup.sh` (CI + local) reads
  it, so tests run against what ships. Bump it there, re-run `worker/setup.sh`, test, commit.
- k8s manifest (`../homeserver/k8s/chapterly/`): worker gets only `TZ`/`CHAPTERLY_*` (no auth secrets), memory
  limits + `--max-old-space-size` below the worker's limit, web sets `TRUST_CF_HEADER=1` (Cloudflare tunnel).

## Library + reader (web/app/_reader, web/lib/reader)
- `/` is one client-rendered page (library, novel, reading views; `/read` redirects there); views switch by
  query string via `history.pushState` so the service worker (`public/sw.js`) can cache it as one shell.
  The library renders from the phone's cached `/api/reader/library` (full rows + progress) and hides
  server-only parts (add, sign-out, check status, Manage link) while `lib/reader/online.ts` says the server
  is unreachable (no network, or the last sync failed with a network error/timeout or a gateway
  502/503/504/530, `online.ts unreachable`). The SW likewise serves the cached shell for any non-ok, non-redirect
  answer to `/` (a Cloudflare 5xx while the home server is down). Layout choice is
  per-device (`viewPref.ts`, localStorage); the novel management page `/novels/[id]` stays server-rendered. Chapters live in IndexedDB (`lib/reader/idb.ts`), not
  the SW cache. That DB is per device, not per user: sign-out (`components/SignOutButton.tsx`) deletes it first.
  Connections close on `versionchange`; a blocked upgrade rejects with `IdbBlockedError` (shown as a notice).
  `client.ts runSync`: one sync at a time; calls during a run share one follow-up run (full if any wanted full). Logic is pure and tested: `progress.ts` (forward-only rules; "behind" = an earlier chapter),
  `plan.ts` (what to keep offline), `scroll.ts`, `sync.ts` (outbox flush + downloads; re-fetches a TOC only when `chapters_fetched` changed; in-memory
  store tests), `label.ts` (chapter label: title, else `Chapter idx+1` — idx is 0-based),
  `settings.ts` (useSyncExternalStore store; server renders defaults).
- API: `app/api/reader/*` are thin wrappers over `lib/reader/api.ts`. Signed-out `/api/*` gets 401 JSON
  (`lib/proxyRules.ts`). `PUT /progress` requires JSON + same Origin (CSRF).
- Every rule applied to chapter HTML (DOMPurify, dropping the site's repeated "Chapter N" heading, …) lives in
  ONE function, `clean()`: `worker/src/clean.js` + its web copy `web/lib/clean.ts` (parity test). Never clean
  elsewhere (not in the EPUB packer, not at render). `chapters.html_clean` = the `CLEAN_VERSION` a row was
  cleaned with. Changing a rule → bump `CLEAN_VERSION` in `clean.js` and `web/lib/cleanVersion.ts`: stale rows
  are re-cleaned on the next reader read / EPUB build, and phones drop cached chapters (IndexedDB version).
- Look: warm paper/charcoal tokens + amber accent in `globals.css` (all text pairs ≥4.5:1 — re-check if you change
  them), Literata as `font-serif` (`layout.tsx` → `--font-literata`). Reader settings add font, width and a
  "system" theme that is pure CSS (uses the page tokens). Library: `ContinueShelf`, `Cover` (hashed-hue placeholder),
  posters default on phones (`viewPref.ts`), add form behind "+". Novel view opens scrolled to the current chapter, so its
  "Library" back bar is sticky; its header links to the online-only manage page `/novels/[id]`; both list chapters in reading order (`idx, id`).
- Per-novel `novels.epub_enabled` gates the EPUB build and the Audiobookshelf rescan.
- Browser-automation testing: the automation tab is hidden, so IntersectionObserver/timers only run while it
  renders — drive it with real scroll input + screenshots.
