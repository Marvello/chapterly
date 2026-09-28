# Web UI — design

Date: 2026-09-28 · Status: approved in conversation, pending spec review

## Goal

A web UI for the novel manager, used by one person (me), often from a phone: see the library,
add a novel by URL, watch it fetch, force a check, fix failing chapters, tune how often each novel
is checked, pause or delete. Reading stays in Audiobookshelf.

Success = everything the CLI does for day-to-day use can be done from the browser, the UI passes
common-tech's `security.md`, and the worker stays the only process that scrapes.

## Decisions

| Topic | Decision |
|---|---|
| Who scrapes | **Only the worker.** The web app reads the DB and writes intents; it never fetches a site. |
| Users | One account, created/changed from the CLI. No signup, no password reset. |
| Login | **Controlled by env.** Local: email/password only (no `AUTH_OIDC_*` set). Tower: OIDC first (authentik on turing), email/password as fallback, which can be disabled with `AUTH_PASSWORD_LOGIN=false`. OIDC never creates accounts. |
| v1 scope | Login · library · add by URL · novel page · check now · pause/resume · delete · retry failed chapters · per-novel check interval. **Not** in v1: EPUB download, in-browser reader. |
| Stack | folionix web stack (`auth-direction.md`): Next.js 16, NextAuth v5 Credentials + JWT session, bcryptjs, Tailwind v4, lucide-react, TypeScript, vitest. |
| Database | **SQLite stays** — documented exception to `postgres-client.md` (user decision 2026-09-28). The standard's non-Postgres parts are adopted: `db/migrations/NNN_name.sql`, ledger `schema_migrations(version, name, applied_at)`, migrations run on start by each process, all SQL in one module (`src/db.js`). |

## 1. Structure and data flow

```
novel/
  cli.js, src/          worker + CLI — the only code that scrapes
  src/db.js             the ONLY module with SQL; imported by worker, CLI and web
  db/migrations/        moved from migrations/
  web/                  Next.js app (TypeScript)
```

The web app imports `src/db.js` directly (CommonJS, `node:sqlite`). Mutations are Next.js server
actions that call `db.js` functions.

### Intents: UI writes, worker acts (worker tick 1 min, was 5)

| UI action | Web writes | Worker |
|---|---|---|
| Add novel | `addNovel(url)`: row with no title/metadata | due immediately (never checked): fetches metadata + TOC, then chapters |
| Check now | `novels.check_requested_at = now` | a novel is due if requested **or** its interval has passed; the request is cleared when the check starts |
| Retry failed chapters | `resetChapterRetries(id)` + check request | fetches them on that check |
| Change interval | `novels.check_interval_min` (allowed: 360, 720, 1440, 4320, 10080) | applies from the next due calculation |
| Pause / resume | `novels.status` | skips `paused` |
| Delete | `deleteNovel(id)` (EPUB file kept) | a check in progress for a deleted novel fails harmlessly: chapter inserts hit the foreign key and are caught, updates match 0 rows, no EPUB is rebuilt |

The CLI keeps `update` (direct check) for debugging; the worker remains the normal path.

### Schema changes (migration `003_web.sql`)

- `novels.check_requested_at TEXT` — set by "check now", cleared when a check starts.
- `novels.check_finished_at TEXT` — set by `markCheckDone`. A novel is **checking** when
  `last_checked_at > coalesce(check_finished_at, '')`.
- `users` — folionix shape plus login-safety columns:
  `id INTEGER PRIMARY KEY, name TEXT, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  failed_logins INTEGER NOT NULL DEFAULT 0, locked_until TEXT, session_version INTEGER NOT NULL DEFAULT 1,
  oidc_sub TEXT UNIQUE, created_at TEXT NOT NULL`.

### Migrations

- Directory `db/migrations/`, ledger `schema_migrations(version TEXT PRIMARY KEY, name TEXT, applied_at TEXT)`
  where `version` is the `NNN` prefix.
- The whole run happens inside `BEGIN IMMEDIATE` (SQLite's write lock), so web and worker booting
  together serialize instead of racing — the SQLite stand-in for `pg_advisory_lock`.
- Each process runs pending migrations on start and refuses to start if one fails.
- The only existing DB is the local Docker test DB (old ledger format); it is recreated, no adoption shim.

## 2. Pages

Tailwind + lucide, folionix look (dark/light), **mobile-first**.

**`/login`** — **"Sign in with authentik"** button first (shown when OIDC is configured), then the
email + password form (hidden when `AUTH_PASSWORD_LOGIN=false`). One error message for every
failure: "Sign-in failed." (unknown user, wrong password, locked, OIDC identity not allowed).
No signup / forgot-password links.

### OIDC (authentik)

**Enabled only when `AUTH_OIDC_ISSUER`, `AUTH_OIDC_ID` and `AUTH_OIDC_SECRET` are all set** — i.e. on
Tower. Locally none are set, so the provider isn't registered and `/login` shows only the password
form. Partial config (some but not all three) fails at startup with a clear error rather than
silently half-working. `AUTH_PASSWORD_LOGIN` defaults to `true`; setting it to `false` without OIDC
configured also fails at startup (would leave no way to log in).

| Env | Local | Tower |
|---|---|---|
| `AUTH_OIDC_ISSUER` / `_ID` / `_SECRET` | unset | set (authentik) |
| `AUTH_PASSWORD_LOGIN` | unset (= true) | `true` (fallback) or `false` |

- NextAuth generic OIDC provider (`type: "oidc"`), configured by env: `AUTH_OIDC_ISSUER`
  (e.g. `https://auth.<domain>/application/o/novel/`), `AUTH_OIDC_ID`, `AUTH_OIDC_SECRET`,
  optional `AUTH_OIDC_NAME` (button label, default "authentik"). Unset issuer → no OIDC button.
  Checks: PKCE + state (NextAuth defaults for OIDC). Scopes: `openid email profile`.
- **Mapping to the single account** (`signIn` callback), in order:
  1. a user with `oidc_sub = sub` exists → allowed;
  2. else a user with `email = profile.email` exists, `profile.email_verified === true`, and that user
     has no `oidc_sub` yet → store `oidc_sub = sub`, allowed;
  3. anything else → rejected (logged), no account created.
  Once bound, a changed email in authentik can't move the login to another account, and a second
  authentik identity with the same email is rejected.
- The resulting JWT carries the same `userId` + `session_version` as a password login, so session
  invalidation (#3) covers both.
- authentik setup (documented in README): OAuth2/OpenID provider + application "novel", redirect URI
  `https://<novel host>/api/auth/callback/oidc`, signing key set (RS256), bound to my user/group only
  (defense in depth — the app enforces the mapping regardless).
- `cli.js user:unlink-oidc <email>` clears `oidc_sub` (e.g. after recreating the authentik user).

**`/` Library**
- Add box: paste URL → server validates (http/https, parses, ≤ 2048 chars, not already added) → novel
  appears at once as "fetching info…".
- Row per novel: cover (remote URL), title, author, `fetched/total` chapters (progress bar while
  fetching), status badge, "checked 3h ago", **+N new** badge (chapters fetched in the last 24 h).
- Status badge, first match wins: `paused` → `fetching info…` (never finished a check and no title)
  → `checking…` → `error` (`last_error` set) → `active`.
- Sort: novels with new chapters first, then title.

**`/novels/[id]` Novel page**
- Header: cover, title, author, parser, source link, EPUB path, check interval, last/next check.
- Actions: **Check now**, **Pause/Resume**, **Interval** select (6h, 12h, daily, 3 days, weekly),
  **Delete** (two-step button "Delete" → "Really delete? EPUB file is kept"; no browser dialog).
- Problems panel (only if any): `last_error`; failing chapters with error, attempts `n/max`, next
  retry time or "gave up"; **Retry failed chapters** button.
- Chapter list: newest first, 100 per page; index, title, fetched ✓ / pending / error, fetched time.

**Live updates**: while a novel is checking or fetching info, the page calls `router.refresh()`
every 5 s; otherwise it's static.

## 3. Security (`common-tech/tech-standard/security.md`)

| # | Item | Control |
|---|---|---|
| 1 | HSTS | `next.config` headers: `Strict-Transport-Security: max-age=31536000; includeSubDomains`, plus `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, CSP `frame-ancestors 'none'`. |
| 3 | Reset sessions on password change | JWT carries `session_version`; the `jwt` callback re-reads the user on each request and rejects a mismatch. `cli.js user:password` bumps it. |
| 5 | No enumeration | One error for all failures (incl. rejected OIDC identities); unknown email still runs `bcrypt.compare` against a fixed dummy hash (equal timing). |
| 11 | Request size | `experimental.serverActions.bodySizeLimit = "64kb"`; URL ≤ 2048 chars. |
| 13 | Input handling | URL parsed + http(s) only; interval from allowlist; ids parsed as positive integers. Parameterized queries only (`src/db.js`). React escaping; scraped text rendered as text; chapter HTML never rendered. |
| 14 | CORS / CSRF | No CORS headers, no cross-origin API. Server actions (Next.js Origin check) for mutations; NextAuth CSRF on sign-in. |
| 15 | Directory listing | Next.js doesn't list; data and library dirs are never served. |
| 16 | Default/debug routes | No seeded user (`cli.js user:create`); OIDC never auto-creates users. Public routes: `/login`, `/api/auth/*`, `/api/health` (returns `ok` only). |
| 17 | Lockout | Password login only (OIDC lockout is authentik's job). 5 failures → lock with exponential backoff 1, 2, 4 … min, cap 60 min (`retry-backoff.md` pattern); success resets. Plus in-memory per-IP limit, 10 login attempts/min (single web process). |
| 18 | Security events | One JSON line to stdout per: login success (method: password/oidc), login failure, OIDC identity rejected, OIDC sub bound, lockout, stale session rejected, password changed/user created (CLI). Fields: event, email, ip, time. Never passwords/tokens. |
| 19 | Cookies | NextAuth `HttpOnly` + `SameSite=Lax`; `useSecureCookies: true` in production (behind Cloudflare Tunnel the app sees http). `AUTH_SECRET` required at start. |
| 20 | DB permissions | **Partial**: SQLite has no roles. Only worker + web mount the data dir; the DB file is created by the container user (`PUID`) and is not world-writable. |
| 4, 12 | Reset links / reset rate limit | N/A — no reset flow; password changed via CLI. |
| 6 | Uploads | N/A — none. |
| 7, 8 | Payments | N/A. |
| 9, 10 | AI | N/A. |

Cloudflare Access sits in front on Tower as defense in depth; the app's own auth must pass on its own.

## 4. Testing and deploy

**Tests**
- Node tests (extend `test/pipeline.test.js` / add `test/db.test.js`): check request picked up and
  cleared; `check_finished_at` / checking state; add → worker fills metadata; ledger format;
  concurrent `openDb` migrations don't clash; user create/verify; lockout backoff (1, 2, 4 … cap 60);
  `session_version` bump; `oidc_sub` bind/lookup/unlink.
- vitest in `web/`: authorize (same result for unknown/wrong/locked, dummy-hash path, lockout, IP
  limit); OIDC mapping (bound sub → ok; verified email + unbound → binds; unverified email → reject;
  unknown email → reject; user already bound to another sub → reject); password login disabled by env; URL + interval validation; status badge + sort; relative time.
- Manual end-to-end against local Docker in the browser (desktop + phone width, screenshots):
  password login + lockout (OIDC not configured locally → no OIDC button), add novel → info → chapters, check now, retry, interval, pause, delete.
- OIDC end to end is verified at the Tower deploy (login via authentik, first-login sub binding,
  rejected foreign identity), not locally; locally OIDC is covered by the vitest mapping tests and a
  config test (all/none/partial env).
- Final `security.md` pass against the code: Pass / Gap / N/A per item recorded in `tasks/todo.md`.

**Deploy**
- `compose.yaml` gains `web`: own image (`web/Dockerfile`, Next.js `output: "standalone"`, no
  WebToEpub), mounts `./data`, port `127.0.0.1:3000:3000`, env `AUTH_SECRET`, `AUTH_URL`, and
  optional `AUTH_OIDC_ISSUER` / `AUTH_OIDC_ID` / `AUTH_OIDC_SECRET` / `AUTH_OIDC_NAME`, `AUTH_PASSWORD_LOGIN`.
- `worker`: `NOVEL_TICK_MIN` default 1; image adds `bcryptjs` for `cli.js user:create <email>` /
  `user:password <email>` (password read from a hidden prompt, never an argument).
- First run: `docker compose up -d --build` → `docker compose exec worker node cli.js user:create <email>`.

## Risks

- **Next.js loading `node:sqlite` + CommonJS `../src/db.js`.** folionix already imports a lib from
  outside its app dir (`outputFileTracingRoot`, `transpilePackages`), so expected to work. Checked
  first in the plan; fallback is a thin typed wrapper in `web/lib` that still delegates all SQL to `db.js`.
- `node:sqlite` is experimental in Node 24 (warning suppressed via `NODE_OPTIONS`); API is stable enough
  for these calls, pinned by the Node 24 image.
