"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { deleteAction } from "@/app/actions";

/** Two-step delete without a browser dialog. */
export default function DeleteButton({ id }: { id: number }) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <button type="button" onClick={() => setArmed(true)} className="flex items-center gap-1 rounded-lg border border-edge px-3 py-2 text-sm text-critical">
        <Trash2 className="size-4" /> Delete
      </button>
    );
  }
  return (
    <form action={deleteAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <button className="rounded-lg bg-critical px-3 py-2 text-sm font-medium text-page">Really delete? (EPUB file is kept)</button>
      <button type="button" onClick={() => setArmed(false)} className="text-sm text-tmuted">Cancel</button>
    </form>
  );
}
