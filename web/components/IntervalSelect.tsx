"use client";

import { setIntervalAction } from "@/app/actions";
import { INTERVALS } from "@/lib/validate";

export default function IntervalSelect({ id, minutes }: { id: number; minutes: number }) {
  return (
    <form action={setIntervalAction}>
      <input type="hidden" name="id" value={id} />
      <label className="flex items-center gap-2 text-sm text-tmuted">
        Check
        {/* key: React 19 resets the form after the action; remount with the saved value instead */}
        <select key={minutes} name="minutes" defaultValue={minutes} onChange={e => e.currentTarget.form?.requestSubmit()}
          className="rounded-lg border border-edge bg-component px-2 py-2 text-tprimary">
          {INTERVALS.map(i => <option key={i.minutes} value={i.minutes}>{i.label}</option>)}
        </select>
      </label>
    </form>
  );
}
