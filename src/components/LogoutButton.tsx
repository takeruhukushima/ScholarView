"use client";

import { signOut } from "@/lib/auth/browser";

export function LogoutButton() {
  async function handleLogout() {
    await signOut();
    window.location.href = "/";
  }

  return (
    <button
      onClick={handleLogout}
      className="text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
    >
      Sign out
    </button>
  );
}
