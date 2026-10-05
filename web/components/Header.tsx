import Link from "next/link";
import { BookOpen } from "lucide-react";
import SignOutButton from "@/components/SignOutButton";

export default function Header({ signOut = true }: { signOut?: boolean }) {
  return (
    <header className="mb-4 flex items-center justify-between">
      <Link href="/" className="flex items-center gap-2 text-lg font-semibold text-tprimary">
        <BookOpen className="size-5 text-accent" /> Chapterly
      </Link>
      {signOut && <SignOutButton />}
    </header>
  );
}
