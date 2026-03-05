"use client";

import { useState } from "react";
import { signInWithHandle } from "@/lib/auth/browser";

export function LoginForm() {
  const [handle, setHandle] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await signInWithHandle(handle);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Bluesky Handle
          </label>
          <input
            type="text"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="user.bsky.social"
            className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white text-slate-900 text-sm outline-none focus:border-indigo-500 transition-all"
            disabled={loading}
          />
        </div>

        {error && <p className="text-red-500 text-xs font-medium">{error}</p>}

        <button
          type="submit"
          disabled={loading || !handle}
          className="w-full py-2 px-4 bg-indigo-600 text-white text-sm font-bold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-all shadow-sm flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Signing in...
            </>
          ) : (
            "Sign in with Bluesky"
          )}
        </button>
      </form>
      
      <p className="text-[10px] text-slate-400 text-center leading-relaxed">
        Logging in will migrate your guest data to your official account.
      </p>
    </div>
  );
}
