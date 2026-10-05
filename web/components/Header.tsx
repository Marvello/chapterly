import Link from "next/link";
import { BookOpen, BookOpenText, LogOut } from "lucide-react";
import { signOutAction } from "@/app/actions";

export default function Header() {
  return (
    <header className="mb-4 flex items-center justify-between">
      <Link href="/" className="flex items-center gap-2 text-lg font-semibold text-tprimary">
        <BookOpen className="size-5 text-accent" /> Chapterly
      </Link>
      <div className="flex items-center gap-4">
        <Link href="/read" className="flex items-center gap-1 text-sm text-tmuted hover:text-tprimary">
          <BookOpenText className="size-4" /> <span className="hidden sm:inline">Reader</span>
        </Link>
        <form action={signOutAction}>
          <button className="flex items-center gap-1 text-sm text-tmuted hover:text-tprimary" aria-label="Sign out">
            <LogOut className="size-4" /> <span className="hidden sm:inline">Sign out</span>
          </button>
        </form>
      </div>
    </header>
  );
}
