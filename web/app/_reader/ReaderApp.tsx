"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { runSync } from "@/lib/reader/client";
import { online } from "@/lib/reader/online";
import { AuthError } from "@/lib/reader/sync";
import { parseId } from "@/lib/validate";
import LibraryView from "./LibraryView";
import NovelView from "./NovelView";
import ReadingView from "./ReadingView";

// Library + reader in one page: views switch by query string (?novel=, &chapter=) via pushState, so the
// service worker can serve the whole thing offline as one cached page.
export default function ReaderApp() {
  const params = useSearchParams();
  const router = useRouter();
  const routerRef = useRef(router);   // the router object changes with the URL; keep sync stable
  useEffect(() => { routerRef.current = router; });
  const novelId = parseId(params.get("novel") ?? "");
  const chapterId = parseId(params.get("chapter") ?? "");
  const [rev, setRev] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const sync = useCallback(() => {
    if (!navigator.onLine) return;
    runSync()
      .then(r => {
        online.setReachable(true);
        setNotice(r.quotaExceeded ? "Phone storage is full, so downloading stopped."
          : r.progressError ? `Reading progress couldn't be saved to the server (${r.progressError}); it will retry.` : null);
        setRev(v => v + 1);
      })
      .catch(e => {
        if (e instanceof AuthError) return routerRef.current.replace("/login");
        // A network error or timeout: the server can't be reached, so show the offline library.
        // (A server error still means it's there.)
        const reachable = !(e instanceof TypeError || (e instanceof DOMException && e.name === "TimeoutError"));
        online.setReachable(reachable);
        setNotice(reachable ? "Sync failed; it will retry when you come back." : null);   // offline: the page says so
      });
  }, []);

  useEffect(() => {
    navigator.serviceWorker?.register("/sw.js").catch(() => {});
    const onVisible = () => { if (document.visibilityState === "visible") sync(); };
    sync();
    window.addEventListener("online", sync);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", sync);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [sync]);

  if (novelId && chapterId) return <ReadingView key={novelId} novelId={novelId} chapterId={chapterId} />;
  if (novelId) return <NovelView novelId={novelId} rev={rev} />;
  return <LibraryView rev={rev} notice={notice} resync={sync} />;
}
