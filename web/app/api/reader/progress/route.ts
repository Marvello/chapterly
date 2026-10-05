import { currentUserId } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { json, putProgress } from "@/lib/reader/api";

const appOrigin = () => new URL(process.env.AUTH_URL || "http://localhost:3000").origin;

export async function PUT(req: Request) {
  const uid = await currentUserId();
  if (!uid) return json({ status: 401, body: { error: "unauthorized" } });
  return json(putProgress(getDb(), uid, req.headers, await req.text(), appOrigin()));
}
