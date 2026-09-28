"use client";

import { setSeriesStatusAction } from "@/app/actions";
import { SERIES_STATUSES, type SeriesStatus } from "@/lib/validate";

export default function SeriesStatusSelect({ id, status, manual }: { id: number; status: SeriesStatus; manual: boolean }) {
  return (
    <form action={setSeriesStatusAction}>
      <input type="hidden" name="id" value={id} />
      <label className="flex items-center gap-2 text-sm text-tmuted">
        Story
        {/* key: React 19 resets the form after the action; remount with the saved value instead */}
        <select key={status} name="series_status" defaultValue={status} onChange={e => e.currentTarget.form?.requestSubmit()}
          className="rounded-lg border border-edge bg-component px-2 py-2 text-tprimary">
          {SERIES_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <span className="text-xs">{manual ? "(set by you)" : "(from site)"}</span>
      </label>
    </form>
  );
}
