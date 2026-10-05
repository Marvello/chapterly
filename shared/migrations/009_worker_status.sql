-- Worker liveness: one row, stamped every tick, so the web UI can warn when the worker isn't running.
CREATE TABLE worker_status (
    id      INTEGER PRIMARY KEY CHECK (id = 1),
    seen_at TEXT NOT NULL
);
