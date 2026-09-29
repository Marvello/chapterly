import { setViewAction } from "@/app/actions";
import { LIBRARY_VIEWS, type LibraryView } from "@/lib/view";

const LABEL: Record<LibraryView, string> = { overview: "Overview", table: "Table", posters: "Posters" };

/** Library layout switcher; the choice is stored in a cookie the page reads on the server. */
export default function ViewToggle({ view }: { view: LibraryView }) {
  return (
    <form action={setViewAction} role="group" aria-label="Library layout"
      className="inline-flex overflow-hidden rounded-lg border border-edge text-sm">
      {LIBRARY_VIEWS.map(v => (
        <button key={v} name="view" value={v} aria-pressed={v === view}
          className={`px-3 py-1 ${v === view ? "bg-accent text-page" : "text-tmuted hover:text-tprimary"}`}>
          {LABEL[v]}
        </button>
      ))}
    </form>
  );
}
