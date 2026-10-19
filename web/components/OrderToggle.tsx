"use client";

import { useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownWideNarrow, ArrowUpNarrowWide } from "lucide-react";
import { orderPref } from "@/lib/reader/orderPref";

/** Newest-first / oldest-first switch for chapter lists. `refresh`: re-render a server page after a change. */
export default function OrderToggle({ refresh = false }: { refresh?: boolean }) {
  const order = useSyncExternalStore(orderPref.subscribe, orderPref.get, orderPref.getServer);
  const router = useRouter();
  const Icon = order === "desc" ? ArrowDownWideNarrow : ArrowUpNarrowWide;
  return (
    <button type="button" title="Change chapter order"
      onClick={() => { orderPref.set(order === "desc" ? "asc" : "desc"); if (refresh) router.refresh(); }}
      className="flex items-center gap-1 text-sm text-tmuted hover:text-tprimary">
      <Icon className="size-4" /> {order === "desc" ? "Newest first" : "Oldest first"}
    </button>
  );
}
