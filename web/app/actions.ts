"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser, signOut } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { checkSupportedSite, parseId, parseInterval, parseNovelUrl, parseSeriesStatus } from "@/lib/validate";
import { VIEW_COOKIE, libraryView } from "@/lib/view";

export type AddState = { error?: string; ok?: boolean } | undefined;

// Every action: session check → validate → db.js call → revalidate. The worker does the actual work.
export async function addNovelAction(_prev: AddState, form: FormData): Promise<AddState> {
  await requireUser();
  const parsed = parseNovelUrl(form.get("url"));
  if (!parsed.ok) return { error: parsed.error };
  const db = getDb();
  const unsupported = checkSupportedSite(parsed.url, host => db.isSupportedHost(host));
  if (unsupported) return { error: unsupported };
  const existing = db.findNovelByUrl(parsed.url);
  if (existing) redirect(`/novels/${existing.id}`);
  db.addNovel(parsed.url); // no title yet → "fetching info…" until the worker's next tick
  revalidatePath("/");
  return { ok: true };
}

async function withNovel(form: FormData, fn: (id: number) => void) {
  await requireUser();
  const id = parseId(form.get("id"));
  if (!id || !getDb().getNovel(id)) return;
  fn(id);
  revalidatePath("/");
  revalidatePath(`/novels/${id}`);
}

export async function checkNowAction(form: FormData) {
  await withNovel(form, id => getDb().requestCheck(id));
}

export async function retryAction(form: FormData) {
  await withNovel(form, id => {
    getDb().resetChapterRetries(id);
    getDb().requestCheck(id);
  });
}

export async function setStatusAction(form: FormData) {
  const status = form.get("status");
  if (status !== "active" && status !== "paused") return;
  await withNovel(form, id => getDb().setStatus(id, status));
}

export async function setIntervalAction(form: FormData) {
  const minutes = parseInterval(form.get("minutes"));
  if (!minutes) return;
  await withNovel(form, id => getDb().setCheckInterval(id, minutes));
}

export async function setSeriesStatusAction(form: FormData) {
  const status = parseSeriesStatus(form.get("series_status"));
  if (!status) return;
  await withNovel(form, id => getDb().setSeriesStatus(id, status));
}

export async function deleteAction(form: FormData) {
  let deleted = false;
  await withNovel(form, id => { getDb().deleteNovel(id); deleted = true; });
  if (deleted) redirect("/");
}

/** Library layout (overview / table / posters), remembered for a year. Unknown values → overview. */
export async function setViewAction(form: FormData) {
  await requireUser();
  const view = libraryView(String(form.get("view") ?? ""));
  (await cookies()).set(VIEW_COOKIE, view, { path: "/", maxAge: 31_536_000, sameSite: "lax", httpOnly: true });
  revalidatePath("/");
}

export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}
