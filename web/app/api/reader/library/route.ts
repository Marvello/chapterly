import { currentUserId } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { json, libraryRows } from "@/lib/reader/api";
import { newSince } from "@/lib/view";

export async function GET() {
  const uid = await currentUserId();
  if (!uid) return json({ status: 401, body: { error: "unauthorized" } });
  const db = getDb();
  return json({ status: 200, body: libraryRows(db.listNovels(newSince()), db.readerLibrary(uid)) });
}
