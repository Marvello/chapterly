"use client";

import { setEpubAction } from "@/app/actions";

export default function EpubToggle({ id, on }: { id: number; on: boolean }) {
  return (
    <form action={setEpubAction}>
      <input type="hidden" name="id" value={id} />
      <label className="flex items-center gap-2 text-sm text-tmuted">
        {/* key: React 19 resets the form after the action; remount with the saved value instead */}
        <input key={String(on)} type="checkbox" name="epub" defaultChecked={on}
          onChange={e => e.currentTarget.form?.requestSubmit()} className="size-4 accent-[var(--accent)]" />
        EPUB for Audiobookshelf
      </label>
    </form>
  );
}
