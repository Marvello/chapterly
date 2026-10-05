/** A reading position: chapter + how far through it (0..1). Ordered by (idx, chapterId, fraction). */
export type Position = { novelId: number; chapterId: number; idx: number; fraction: number };
/** Unsent progress for one novel. force = the reader confirmed moving back. */
export type OutboxEntry = Position & { readAt: string; force: boolean };
/** A chapter kept on the phone (also the shape /api/reader/novels/:id/chapters returns). */
export type StoredChapter = { id: number; novelId: number; idx: number; title: string | null; html: string };
