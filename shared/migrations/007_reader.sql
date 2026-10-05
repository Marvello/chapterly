-- Reader: one position per (user, novel), forward-only unless forced (enforced in db.js saveProgress).
-- `fraction` = 0..1 through the chapter. read_at = client time of the reading (library sort only).
CREATE TABLE reading_progress (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    novel_id   INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
    chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    fraction   REAL NOT NULL DEFAULT 0,
    read_at    TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, novel_id)
);
-- EPUB building / Audiobookshelf rescan, per novel (1 = today's behaviour).
ALTER TABLE novels ADD COLUMN epub_enabled INTEGER NOT NULL DEFAULT 1;
-- 1 = html has been through DOMPurify (worker before saving; web on first read for older rows).
ALTER TABLE chapters ADD COLUMN html_clean INTEGER NOT NULL DEFAULT 0;
