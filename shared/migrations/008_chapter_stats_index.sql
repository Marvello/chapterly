-- Covers listNovels' per-novel aggregates (runs every worker tick): counted from the index, never the html rows.
-- fetched_at IS NULL <=> html IS NULL (saveChapter sets both).
CREATE INDEX chapters_stats_idx ON chapters (novel_id, fetched_at, attempts, retry_at);
