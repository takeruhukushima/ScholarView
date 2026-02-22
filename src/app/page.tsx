"use client";

import { useEffect, useState } from "react";

import { WorkspaceApp } from "@/components/workspace/WorkspaceApp";
import { initializeAuth } from "@/lib/auth/browser";
import { installClientFetchBridge } from "@/lib/client/fetch-bridge";
import type { ArticleSummary } from "@/lib/types";

export default function HomePage() {
  const [ready, setReady] = useState(false);
  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [sessionDid, setSessionDid] = useState<string | null>(null);
  const [accountHandle, setAccountHandle] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    installClientFetchBridge();
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      installClientFetchBridge();

      try {
        const auth = await initializeAuth();
        if (cancelled) return;
        setSessionDid(auth.did);
        setAccountHandle(auth.handle);

        const response = await fetch("/api/articles", { cache: "no-store" });
        const data = (await response.json()) as {
          success?: boolean;
          articles?: ArticleSummary[];
        };

        if (!cancelled && response.ok && data.success && Array.isArray(data.articles)) {
          setArticles(data.articles);
        }
      } catch (error) {
        if (!cancelled) {
          setBootError(
            error instanceof Error ? error.message : "Failed to initialize ScholarView",
          );
        }
      } finally {
        if (!cancelled) {
          setReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,_#E9F4FF_0%,_#F8FAFC_45%)] p-4 md:p-6">
        <div className="mx-auto max-w-5xl rounded-xl border bg-white p-6 text-sm text-slate-600 shadow-sm">
          Initializing ScholarView...
        </div>
      </main>
    );
  }

  if (bootError) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,_#E9F4FF_0%,_#F8FAFC_45%)] p-4 md:p-6">
        <div className="mx-auto max-w-5xl rounded-xl border border-red-200 bg-white p-6 text-sm text-red-700 shadow-sm">
          Failed to initialize ScholarView: {bootError}
        </div>
      </main>
    );
  }

  return (
    <WorkspaceApp
      initialArticles={articles}
      sessionDid={sessionDid}
      accountHandle={accountHandle}
    />
  );
}
