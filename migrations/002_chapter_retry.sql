-- Per-chapter retry state: failed attempts so far, and when the next attempt is allowed.
ALTER TABLE chapters ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chapters ADD COLUMN retry_at TEXT;
