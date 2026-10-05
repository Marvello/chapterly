"use client";

import { useSyncExternalStore } from "react";
import { viewPref } from "@/lib/reader/viewPref";
import { LIBRARY_VIEWS, type LibraryView } from "@/lib/view";

const LABEL: Record<LibraryView, string> = { overview: "Overview", table: "Table", posters: "Posters" };

/** Library layout switcher; remembered on this device (works offline). */
export default function ViewToggle() {
  const view = useSyncExternalStore(viewPref.subscribe, viewPref.get, viewPref.getServer);
  return (
    <div role="group" aria-label="Library layout" className="inline-flex overflow-hidden rounded-lg border border-edge text-sm">
      {LIBRARY_VIEWS.map(v => (
        <button key={v} type="button" onClick={() => viewPref.set(v)} aria-pressed={v === view}
          className={`px-3 py-1 ${v === view ? "bg-accent text-page" : "text-tmuted hover:text-tprimary"}`}>
          {LABEL[v]}
        </button>
      ))}
    </div>
  );
}
