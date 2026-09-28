-- Whether the story itself is still being written. Set from the site's og:novel:status tag unless you
-- set it yourself (series_status_manual = 1). Completed + fully fetched novels stop being checked.
ALTER TABLE novels ADD COLUMN series_status TEXT NOT NULL DEFAULT 'ongoing'
    CHECK (series_status IN ('ongoing', 'completed', 'dropped'));
ALTER TABLE novels ADD COLUMN series_status_manual INTEGER NOT NULL DEFAULT 0;
