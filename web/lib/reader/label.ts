/** A chapter's display name: its title, else its number (idx is 0-based; titles can be ""). */
export const chapterLabel = (c: { title?: string | null; idx: number }) => c.title || `Chapter ${c.idx + 1}`;
