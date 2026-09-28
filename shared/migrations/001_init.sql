-- Portable SQL (SQLite now, Postgres later): TEXT/INTEGER only, ISO-8601 text timestamps.
-- On Postgres, swap INTEGER PRIMARY KEY for BIGINT GENERATED ALWAYS AS IDENTITY.
CREATE TABLE novels (
    id                 INTEGER PRIMARY KEY,
    toc_url            TEXT NOT NULL UNIQUE,
    parser             TEXT,
    title              TEXT,
    author             TEXT,
    language           TEXT,
    subjects           TEXT,
    description        TEXT,
    cover_url          TEXT,
    status             TEXT NOT NULL DEFAULT 'active',   -- active | paused | completed
    check_interval_min INTEGER NOT NULL DEFAULT 1440, -- once a day
    last_checked_at    TEXT,
    last_success_at    TEXT,
    last_error         TEXT,
    epub_path          TEXT,
    epub_built_at      TEXT,
    created_at         TEXT NOT NULL
);

-- html IS NULL = listed in the TOC but not fetched yet (or last fetch failed, see error).
CREATE TABLE chapters (
    id         INTEGER PRIMARY KEY,
    novel_id   INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
    idx        INTEGER NOT NULL,
    url        TEXT NOT NULL,
    title      TEXT,
    html       TEXT,
    fetched_at TEXT,
    error      TEXT,
    UNIQUE (novel_id, url)
);
CREATE INDEX chapters_novel_idx ON chapters (novel_id, idx);
