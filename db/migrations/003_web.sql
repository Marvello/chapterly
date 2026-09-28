-- Web UI: "check now" requests, check completion time, and the login account(s).
ALTER TABLE novels ADD COLUMN check_requested_at TEXT;
ALTER TABLE novels ADD COLUMN check_finished_at TEXT;

-- folionix users shape (email, name, password_hash) plus login safety and OIDC binding.
CREATE TABLE users (
    id              INTEGER PRIMARY KEY,
    name            TEXT,
    email           TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    failed_logins   INTEGER NOT NULL DEFAULT 0,
    locked_until    TEXT,
    session_version INTEGER NOT NULL DEFAULT 1,
    oidc_sub        TEXT UNIQUE,
    created_at      TEXT NOT NULL
);
