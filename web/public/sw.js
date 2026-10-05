// Chapterly reader service worker: keeps the /read app shell so the reader opens offline.
// Chapters are not cached here — the reader stores them in IndexedDB itself.
// ponytail: hashed /_next/static files from old deploys pile up in this cache; bump CACHE to clear them.
const CACHE = "chapterly-shell-v1";

async function cacheShell() {
  const cache = await caches.open(CACHE);
  const res = await fetch("/read");
  if (!res.ok || res.redirected) return;   // signed out: nothing worth caching
  const html = await res.clone().text();
  await cache.put("/read", res);
  const assets = [...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)].map(m => m[1]);
  await cache.addAll([...new Set(assets)]);
}

self.addEventListener("install", e => e.waitUntil(cacheShell().catch(() => {}).then(() => self.skipWaiting())));

self.addEventListener("activate", e => e.waitUntil(
  caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())));

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/_next/static/")) {
    // Hashed file names never change: cache first.
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    })));
  } else if (e.request.mode === "navigate" && url.pathname === "/read") {
    // The shell: network first (fresh deploys), cached copy when offline.
    e.respondWith(fetch(e.request).then(res => {
      if (res.ok && !res.redirected) { const copy = res.clone(); caches.open(CACHE).then(c => c.put("/read", copy)); }
      return res;
    }).catch(() => caches.match("/read")));
  }
});
