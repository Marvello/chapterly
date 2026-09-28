import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import type { Provider } from "next-auth/providers";
import { readAuthConfig } from "./authConfig";
import { getDb } from "./db";
import { decideOidcLogin } from "./oidcLogin";
import { verifyPasswordLogin } from "./passwordLogin";
import { createRateLimiter } from "./rateLimit";
import { securityLog } from "./securityLog";
import { checkSession } from "./session";

const allowIp = createRateLimiter(10, 60_000); // security.md #17: 10 password attempts / min / IP

/** Behind Cloudflare Tunnel the client IP is in cf-connecting-ip; the port is bound to 127.0.0.1. */
export function clientIp(h: Headers): string {
  return h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
}

type Token = { uid?: number; sv?: number; email?: string | null; name?: string | null };

// Lazy config: env is read per request, not at build time (`next build` has no AUTH_SECRET).
export const { handlers, signIn, signOut, auth } = NextAuth((): NextAuthConfig => {
  const cfg = readAuthConfig();
  const db = getDb();
  const providers: Provider[] = [];
  if (cfg.oidc) {
    providers.push({
      id: "oidc", name: cfg.oidc.name, type: "oidc",
      issuer: cfg.oidc.issuer, clientId: cfg.oidc.clientId, clientSecret: cfg.oidc.clientSecret,
      checks: ["pkce", "state"],
      authorization: { params: { scope: "openid email profile" } },
    });
  }
  if (cfg.passwordLogin) {
    providers.push(Credentials({
      credentials: { email: {}, password: {} },
      authorize: (c, request) =>
        verifyPasswordLogin(c?.email, c?.password, clientIp(request.headers), { db, log: securityLog, allowIp }),
    }));
  }
  return {
    providers,
    trustHost: true,
    session: { strategy: "jwt" },
    pages: { signIn: "/login", error: "/login" },
    useSecureCookies: (process.env.AUTH_URL ?? "").startsWith("https://"), // security.md #19 (Tower is https)
    callbacks: {
      signIn({ account, profile }) {
        if (account?.provider !== "oidc") return true;
        const d = decideOidcLogin(profile ?? {}, db);
        if (!d.allow) {
          securityLog("oidc_rejected", { reason: d.reason, email: profile?.email });
          return false;
        }
        if (d.bind) {
          db.bindOidcSub(d.userId, String(profile!.sub));
          securityLog("oidc_bound", { email: profile?.email });
        }
        securityLog("login_success", { email: profile?.email, method: "oidc" });
        return true;
      },
      jwt({ token, user, account, profile }) {
        const t = token as typeof token & Token;
        if (account) { // first call after sign-in: pin our user id + session_version
          const u = account.provider === "oidc" ? db.getUserByOidcSub(String(profile?.sub)) : db.getUserById(Number(user?.id));
          if (!u) return null;
          return { ...t, uid: u.id, sv: u.session_version, email: u.email, name: u.name };
        }
        if (!checkSession(t, db)) {
          securityLog("stale_session_rejected", { email: t.email });
          return null;
        }
        return t;
      },
      session({ session, token }) {
        const t = token as Token;
        session.user = { ...session.user, email: t.email ?? "", name: t.name ?? null };
        return session;
      },
    },
  };
});

/** Server actions check the session themselves (defense in depth next to proxy.ts). */
export async function requireUser(): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new Error("Not signed in");
}
