"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { runSync } from "@/lib/reader/client";
import { AuthError } from "@/lib/reader/sync";
import { parseId } from "@/lib/validate";
import HomeView from "./HomeView";
import NovelView from "./NovelView";
import ReadingView from "./ReadingView";

// Views switch by query string (?novel=, &chapter=) via pushState, so the whole reader is one cached page.
export default function ReaderApp() {
  const params = useSearchParams();
  const router = useRouter();
  const novelId = parseId(params.get("novel") ?? "");
  const chapterId = parseId(params.get("chapter") ?? "");
  const [rev, setRev] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    navigator.serviceWorker?.register("/sw.js").catch(() => {});
    const sync = () => {
      if (!navigator.onLine) return;
      runSync()
        .then(r => {
          setNotice(r.quotaExceeded ? "Phone storage is full, so downloading stopped."
            : r.progressError ? `Reading progress couldn't be saved to the server (${r.progressError}); it will retry.` : null);
          setRev(v => v + 1);
        })
        .catch(e => {
          if (e instanceof AuthError) router.replace("/login");
          else setNotice("Sync failed; it will retry when you come back.");
        });
    };
    const onVisible = () => { if (document.visibilityState === "visible") sync(); };
    sync();
    window.addEventListener("online", sync);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", sync);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  if (novelId && chapterId) return <ReadingView key={novelId} novelId={novelId} chapterId={chapterId} />;
  if (novelId) return <NovelView novelId={novelId} rev={rev} />;
  return <HomeView rev={rev} notice={notice} />;
}
