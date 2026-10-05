import { currentUserId } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { chapters, json } from "@/lib/reader/api";
import { clean } from "@/lib/clean";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await currentUserId())) return json({ status: 401, body: { error: "unauthorized" } });
  return json(chapters(getDb(), clean, (await params).id, new URL(req.url).searchParams));
}
