// In-memory sliding window per key. ponytail: single web process; move to the DB if we ever run replicas.
export function createRateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (key: string, at = Date.now()): boolean => {
    if (hits.size > 10_000) hits.clear(); // bound memory against many distinct IPs
    const recent = (hits.get(key) ?? []).filter(t => at - t < windowMs);
    const allowed = recent.length < limit;
    if (allowed) recent.push(at);
    hits.set(key, recent);
    return allowed;
  };
}

/** Rate-limit key. cf-connecting-ip is set by Cloudflare (tunnel) and can't be spoofed through it, but anyone
 *  reaching the app directly can send it, so it is trusted only with TRUST_CF_HEADER=1. Otherwise every client
 *  shares one bucket (per-account lockout still applies). x-forwarded-for is never trusted: any client sets it. */
export function clientIp(h: Headers, trustCf = process.env.TRUST_CF_HEADER === "1"): string {
  return (trustCf && h.get("cf-connecting-ip")) || "unknown";
}
