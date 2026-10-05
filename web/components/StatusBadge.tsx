import type { Status } from "@/lib/view";

const STYLE: Record<Status, [string, string]> = {
  active: ["active", "border-edge text-tmuted"],
  paused: ["paused", "border-edge text-tmuted"],
  fetching_info: ["fetching info…", "border-accent text-accent"],
  checking: ["checking…", "border-accent text-accent"],
  error: ["error", "border-critical text-critical"],
};

export default function StatusBadge({ status }: { status: Status }) {
  const [label, cls] = STYLE[status];
  return <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-xs ${cls}`}>{label}</span>;
}

/** The primary library badge: chapters after this user's progress. */
export function UnreadPill({ count, className = "" }: { count: number; className?: string }) {
  return <span className={`whitespace-nowrap rounded-full bg-accent px-2 text-xs font-medium text-page ${className}`}>{count} unread</span>;
}

/** Chapters fetched in the last 24 h: a small dot, labelled for screen readers and on hover. */
export function NewDot({ count, className = "" }: { count: number; className?: string }) {
  const label = `${count} new chapter${count === 1 ? "" : "s"}`;
  return <span role="img" aria-label={label} title={label} className={`inline-block size-2 shrink-0 rounded-full bg-accent ${className}`} />;
}
