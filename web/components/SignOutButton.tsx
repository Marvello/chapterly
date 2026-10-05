"use client";

import { LogOut } from "lucide-react";
import { signOutAction } from "@/app/actions";
import { deleteReaderDb } from "@/lib/reader/idb";

/** Clears this device's reader data (library, chapters, unsent progress) before signing out. */
export default function SignOutButton() {
  return (
    <form action={async () => { await deleteReaderDb(); await signOutAction(); }}>
      <button className="flex items-center gap-1 text-sm text-tmuted hover:text-tprimary" aria-label="Sign out">
        <LogOut className="size-4" /> <span className="hidden sm:inline">Sign out</span>
      </button>
    </form>
  );
}
