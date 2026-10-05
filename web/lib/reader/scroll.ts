/** Chapter blocks in document coordinates, top to bottom. */
export type ScrollBlock = { chapterId: number; idx: number; top: number; height: number };

/** The chapter at the top of the viewport and how far through it the reader is. */
export function positionFromScroll(blocks: ScrollBlock[], scrollTop: number) {
  const b = blocks.find(x => scrollTop < x.top + x.height) ?? blocks.at(-1);
  if (!b) return null;
  const fraction = b.height > 0 ? Math.min(1, Math.max(0, (scrollTop - b.top) / b.height)) : 0;
  return { chapterId: b.chapterId, idx: b.idx, fraction };
}
