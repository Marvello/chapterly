// What proxy.ts does with a request. API callers get a 401 (a fetch would otherwise follow the
// redirect and receive the login page's HTML); the PWA manifest, service worker and icons are public
// because browsers fetch the manifest without cookies.
export const PUBLIC_PATHS = ["/login", "/api/auth", "/api/health", "/robots.txt", "/icon.svg",
  "/manifest.webmanifest", "/sw.js", "/icon-192.png", "/icon-512.png"];

export function proxyDecision(path: string, signedIn: boolean): "next" | "unauthorized" | "login" {
  if (signedIn || PUBLIC_PATHS.some(p => path === p || path.startsWith(`${p}/`))) return "next";
  return path.startsWith("/api/") ? "unauthorized" : "login";
}
