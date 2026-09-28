import { describe, expect, it } from "vitest";
import { readAuthConfig } from "./authConfig";

const base = { AUTH_SECRET: "s" };
const oidc = { AUTH_OIDC_ISSUER: "https://auth.example/application/o/chapterly/", AUTH_OIDC_ID: "id", AUTH_OIDC_SECRET: "sec" };

describe("readAuthConfig", () => {
  it("local: password only when no OIDC env", () => {
    expect(readAuthConfig(base)).toEqual({ passwordLogin: true, oidc: null });
  });
  it("empty strings count as unset (compose passes ${VAR:-})", () => {
    expect(readAuthConfig({ ...base, AUTH_OIDC_ISSUER: "", AUTH_OIDC_ID: "", AUTH_OIDC_SECRET: "" }).oidc).toBeNull();
  });
  it("tower: OIDC enabled when all three are set, default label authentik", () => {
    expect(readAuthConfig({ ...base, ...oidc })).toEqual({
      passwordLogin: true,
      oidc: { issuer: oidc.AUTH_OIDC_ISSUER, clientId: "id", clientSecret: "sec", name: "authentik" },
    });
    expect(readAuthConfig({ ...base, ...oidc, AUTH_OIDC_NAME: "SSO" }).oidc?.name).toBe("SSO");
  });
  it("password login can be switched off only when OIDC is configured", () => {
    expect(readAuthConfig({ ...base, ...oidc, AUTH_PASSWORD_LOGIN: "false" }).passwordLogin).toBe(false);
    expect(() => readAuthConfig({ ...base, AUTH_PASSWORD_LOGIN: "false" })).toThrow(/nobody can log in/);
  });
  it("rejects partial OIDC config", () => {
    expect(() => readAuthConfig({ ...base, AUTH_OIDC_ISSUER: oidc.AUTH_OIDC_ISSUER })).toThrow(/partially configured/);
  });
  it("rejects a non-boolean AUTH_PASSWORD_LOGIN and a missing secret", () => {
    expect(() => readAuthConfig({ ...base, AUTH_PASSWORD_LOGIN: "no" })).toThrow(/true or false/);
    expect(() => readAuthConfig({})).toThrow(/AUTH_SECRET/);
  });
});
