import { readAuthConfig } from "@/lib/authConfig";
import LoginForm from "@/components/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const cfg = readAuthConfig();
  const { error } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <LoginForm passwordLogin={cfg.passwordLogin} oidcName={cfg.oidc?.name ?? null} initialError={!!error} />
    </main>
  );
}
