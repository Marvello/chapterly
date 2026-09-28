"use client";

import { useActionState, useEffect, useRef } from "react";
import { Plus } from "lucide-react";
import { addNovelAction, type AddState } from "@/app/actions";

export default function AddNovelForm() {
  const [state, action, pending] = useActionState<AddState, FormData>(addNovelAction, undefined);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) form.current?.reset(); }, [state]);
  return (
    <form ref={form} action={action} className="mb-6">
      <div className="flex gap-2">
        <input name="url" type="url" required maxLength={2048} inputMode="url" placeholder="Paste a novel's page URL"
          className="min-w-0 flex-1 rounded-lg border border-edge bg-component px-3 py-2 text-tprimary" />
        <button disabled={pending} className="flex items-center gap-1 rounded-lg bg-accent px-3 py-2 font-medium text-page disabled:opacity-60">
          <Plus className="size-4" /> Add
        </button>
      </div>
      {state?.error && <p className="mt-2 text-sm text-critical" role="alert">{state.error}</p>}
    </form>
  );
}
