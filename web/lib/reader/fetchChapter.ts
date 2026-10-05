// One chapter for the reading view: the phone's copy, else the server. The server pages by "after
// chapter X", so a stored toc that is missing a chapter (fetched since) would point at the wrong spot:
// ask for a window and pick by id, and refresh the toc once if it isn't there.
import type { TocEntry } from "@/lib/db";
import type { ReaderApi, ReaderStore } from "./sync";
import type { StoredChapter } from "./types";

const WINDOW = 20;

export async function fetchChapter(api: Pick<ReaderApi, "toc" | "chapters">, store: ReaderStore, novelId: number,
  toc: TocEntry[], id: number): Promise<{ chapter: StoredChapter | null; toc: TocEntry[] }> {
  const hit = await store.getChapter(id);
  if (hit) return { chapter: hit, toc };
  const tryWith = async (list: TocEntry[]) => {
    const i = list.findIndex(c => c.id === id);
    if (i < 0) return null;
    const rows = await api.chapters(novelId, i > 0 ? list[i - 1].id : null, WINDOW);
    const found = rows.find(r => r.id === id) ?? null;
    if (found) await store.putChapters([found]);
    return found;
  };
  const first = await tryWith(toc);
  if (first) return { chapter: first, toc };
  const fresh = await api.toc(novelId);
  await store.setToc(novelId, fresh);
  return { chapter: await tryWith(fresh), toc: fresh };
}
