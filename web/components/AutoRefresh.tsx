"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-render server data every 5 s while something is being fetched; idle otherwise. */
export default function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}
