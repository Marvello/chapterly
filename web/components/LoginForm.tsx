"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BookOpen, KeyRound } from "lucide-react";

const ERROR = "Sign-in failed."; // one message for every failure (security.md #5)

export default function LoginForm({ passwordLogin, oidcName, initialError }:
  { passwordLogin: boolean; oidcName: string | null; initialError: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialError);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(false);
    const res = await signIn("credentials", { email, password, redirect: false });
    if (res?.error) {
      setLoading(false);
      setError(true);
      return;
    }
    router.push("/");
    router.refresh(); // re-render server components with the new session cookie
  }

  return (
    <div className="w-full max-w-sm rounded-xl border border-edge bg-component p-6">
      <h1 className="mb-6 flex items-center gap-2 font-serif text-xl font-semibold text-tprimary">
        <BookOpen className="size-5 text-accent" /> Chapterly
      </h1>
      {error && <p className="mb-4 text-sm text-critical" role="alert">{ERROR}</p>}
      {oidcName && (
        <button type="button" onClick={() => signIn("oidc", { redirectTo: "/" })}
          className="mb-4 flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 font-medium text-page">
          <KeyRound className="size-4" /> Sign in with {oidcName}
        </button>
      )}
      {oidcName && passwordLogin && <p className="mb-4 text-center text-xs text-tmuted">or</p>}
      {passwordLogin && (
        <form onSubmit={submit} className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-sm text-tmuted">Email</span>
            <input type="email" required autoComplete="username" value={email} onChange={e => setEmail(e.target.value)}
              className="w-full rounded-lg border border-edge bg-page px-3 py-2 text-tprimary" />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-tmuted">Password</span>
            <input type="password" required autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)}
              className="w-full rounded-lg border border-edge bg-page px-3 py-2 text-tprimary" />
          </label>
          <button type="submit" disabled={loading}
            className={`w-full rounded-lg px-4 py-2.5 font-medium ${oidcName ? "border border-edge text-tprimary" : "bg-accent text-page"} disabled:opacity-60`}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      )}
    </div>
  );
}
