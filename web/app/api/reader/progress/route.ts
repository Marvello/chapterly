import { currentUserId } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { json, putProgress } from "@/lib/reader/api";
import { readCapped } from "@/lib/validate";

const appOrigin = () => new URL(process.env.AUTH_URL || "http://localhost:3000").origin;

export async function PUT(req: Request) {
  const uid = await currentUserId();
  if (!uid) return json({ status: 401, body: { error: "unauthorized" } });
  const body = await readCapped(req, 4096); // a progress update is ~100 bytes
  if (body === null) return json({ status: 413, body: { error: "too large" } });
  return json(putProgress(getDb(), uid, req.headers, body, appOrigin()));
}
