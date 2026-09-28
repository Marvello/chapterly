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
