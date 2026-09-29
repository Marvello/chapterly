"use client";
import { Search } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { LIBRARY_FILTERS, LIBRARY_SORTS, type LibraryQuery } from "@/lib/view";

const DEFAULTS: LibraryQuery = { sort: "new", filter: "all", q: "" };
const select = "rounded-lg border border-edge bg-component px-2 py-1 text-sm text-tprimary";

/** Sort / filter / search for the library, kept in the URL (?sort=&filter=&q=). Sort and filter changes
 * add a history entry (Back undoes them); typing replaces it, so Back doesn't step through every letter. */
export default function LibraryControls({ query }: { query: LibraryQuery }) {
  const router = useRouter();
  const pathname = usePathname();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // The box follows the URL when ?q= changes (back/forward), but not while you're still typing.
  const [text, setText] = useState(query.q);
  const [typing, setTyping] = useState(false);
  const [seenQ, setSeenQ] = useState(query.q);
  if (query.q !== seenQ) {
    setSeenQ(query.q);
    if (!typing && query.q !== text.trim()) setText(query.q);
  }

  const go = (patch: Partial<LibraryQuery>, history: "push" | "replace" = "push") => {
    const next = { ...query, ...patch };
    const params = new URLSearchParams();
    for (const k of ["sort", "filter", "q"] as const) if (next[k] && next[k] !== DEFAULTS[k]) params.set(k, next[k]);
    const qs = params.toString();
    router[history](qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const search = (q: string) => {
    setText(q);
    setTyping(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { setTyping(false); go({ q: q.trim() }, "replace"); }, 250);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="relative min-w-40 flex-1">
        <span className="sr-only">Search title or author</span>
        <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-tmuted" />
        <input type="search" value={text} onChange={e => search(e.target.value)} placeholder="Search title or author"
          className="w-full rounded-lg border border-edge bg-component py-1 pl-8 pr-2 text-sm text-tprimary" />
      </label>
      <label className="flex items-center gap-1 text-sm text-tmuted">
        Show
        <select value={query.filter} onChange={e => go({ filter: e.target.value as LibraryQuery["filter"] })} className={select}>
          {Object.entries(LIBRARY_FILTERS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-1 text-sm text-tmuted">
        Sort
        <select value={query.sort} onChange={e => go({ sort: e.target.value as LibraryQuery["sort"] })} className={select}>
          {Object.entries(LIBRARY_SORTS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      </label>
    </div>
  );
}
