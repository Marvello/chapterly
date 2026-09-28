// Which login methods are on, from env. Local: password only. Tower: OIDC (authentik) + optional password.
export interface OidcConfig { issuer: string; clientId: string; clientSecret: string; name: string }
export interface AuthConfig { passwordLogin: boolean; oidc: OidcConfig | null }

type Env = Record<string, string | undefined>;

export function readAuthConfig(env: Env = process.env): AuthConfig {
  if (!env.AUTH_SECRET) throw new Error("AUTH_SECRET is required (openssl rand -base64 32)");

  const { AUTH_OIDC_ISSUER: issuer, AUTH_OIDC_ID: clientId, AUTH_OIDC_SECRET: clientSecret } = env;
  const set = [issuer, clientId, clientSecret].filter(Boolean).length;
  if (set !== 0 && set !== 3) {
    throw new Error("OIDC is partially configured: set all of AUTH_OIDC_ISSUER, AUTH_OIDC_ID, AUTH_OIDC_SECRET, or none");
  }
  const oidc = set === 3 ? { issuer: issuer!, clientId: clientId!, clientSecret: clientSecret!, name: env.AUTH_OIDC_NAME || "authentik" } : null;

  const raw = (env.AUTH_PASSWORD_LOGIN || "true").toLowerCase();
  if (raw !== "true" && raw !== "false") throw new Error("AUTH_PASSWORD_LOGIN must be true or false");
  const passwordLogin = raw === "true";
  if (!passwordLogin && !oidc) throw new Error("AUTH_PASSWORD_LOGIN=false without OIDC configured: nobody can log in");

  return { passwordLogin, oidc };
}
