-- Whole-check retry: a check that fails before any chapter is fetched (e.g. the TOC page times out)
-- is retried with backoff instead of waiting a full interval (which lands in the same bad time slot).
ALTER TABLE novels ADD COLUMN check_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE novels ADD COLUMN check_retry_at TEXT;
