import { currentUserId } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { json, toc } from "@/lib/reader/api";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await currentUserId())) return json({ status: 401, body: { error: "unauthorized" } });
  return json(toc(getDb(), (await params).id));
}
