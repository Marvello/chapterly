import type { NextConfig } from "next";

// common-tech security.md #1 (HSTS) + basic hardening, on every response.
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  // form-action: no form may post off-site (scraped chapter HTML is sanitized too). OIDC sign-in is fetch +
  // window.location, and server-action forms (sign-out included) post to self, so 'self' covers them.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; form-action 'self'" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: import.meta.dirname, // standalone server.js at the image root
  experimental: { serverActions: { bodySizeLimit: "64kb" } }, // security.md #11
  // The reader used to live at /read; it is now the library page itself (query string is kept).
  async redirects() {
    return [{ source: "/read", destination: "/", permanent: false }];
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // The browser must always re-check the service worker, or reader updates never arrive.
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
    ];
  },
};

export default nextConfig;
