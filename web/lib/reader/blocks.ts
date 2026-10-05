/**
 * Add a loaded chapter to the reading view's list. `afterId` is the chapter it was loaded to follow:
 * if the list moved on while it loaded (a jump to another chapter, or it's already there), the result
 * is dropped — appending it anyway would skip or repeat a chapter. Past `max`, the oldest is trimmed.
 */
export function appendBlock<T extends { id: number }>(prev: T[], afterId: number, b: T, max: number): T[] {
  if (prev.at(-1)?.id !== afterId || prev.some(x => x.id === b.id)) return prev;
  const next = [...prev, b];
  return next.length > max ? next.slice(next.length - max) : next;
}
