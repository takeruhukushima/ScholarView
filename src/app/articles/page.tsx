"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { buildPaperPath } from "@/lib/articles/uri";
import { installClientFetchBridge } from "@/lib/client/fetch-bridge";
import type { ArticleSummary } from "@/lib/types";

function useArticleSearch(initialQuery = "") {
  const [query, setQuery] = useState(initialQuery);
  const [loading, setLoading] = useState(false);
  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function search(nextQuery = query) {
    setLoading(true);
    setError(null);
    try {
      installClientFetchBridge();
      const qs = nextQuery.trim() ? `?q=${encodeURIComponent(nextQuery.trim())}` : "";
      const response = await fetch(`/api/articles${qs}`, { cache: "no-store" });
      const data = (await response.json()) as {
        success?: boolean;
        articles?: ArticleSummary[];
        error?: string;
      };
      if (!response.ok || !data.success || !Array.isArray(data.articles)) {
        throw new Error(data.error ?? "Failed to load articles");
      }
      setArticles(data.articles);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load articles");
    } finally {
      setLoading(false);
    }
  }

  return {
    query,
    setQuery,
    loading,
    articles,
    error,
    search,
  };
}

export default function ArticlesPage() {
  const { query, setQuery, loading, articles, error, search } = useArticleSearch();
  const resultLabel = useMemo(() => `${articles.length} result(s)`, [articles.length]);

  useEffect(() => {
    void search("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,_#E9F4FF_0%,_#F8FAFC_45%)] p-4 md:p-6">
      <div className="mx-auto max-w-5xl rounded-xl border bg-white p-4 shadow-sm md:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">All Articles</h1>
            <p className="text-sm text-slate-500">Search and browse all published articles</p>
          </div>
          <Link href="/" className="rounded-md border px-3 py-1.5 text-sm hover:bg-slate-50">
            Back to Workspace
          </Link>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void search(query);
          }}
          className="mb-4 flex gap-2"
        >
          <input
            type="search"
            name="q"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title or content..."
            className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-[#0085FF]"
          />
          <button
            type="submit"
            className="rounded-md bg-[#0085FF] px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
            disabled={loading}
          >
            {loading ? "Searching..." : "Search"}
          </button>
        </form>

        {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
        <p className="mb-3 text-xs text-slate-500">{resultLabel}</p>

        {articles.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-slate-500">
            No articles found.
          </p>
        ) : (
          <ul className="space-y-2">
            {articles.map((article) => (
              <li key={article.uri}>
                <Link
                  href={buildPaperPath(article.did, article.rkey)}
                  className="block rounded-md border p-3 hover:bg-slate-50"
                >
                  <p className="text-sm font-medium text-slate-900">{article.title}</p>
                  {article.authors?.length > 0 && (
                    <p className="mt-0.5 text-[11px] text-slate-600">
                      {article.authors.map((a) => a.name || a.did).join(", ")}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-slate-500">
                    @{article.handle ?? article.authorDid} ·{" "}
                    {new Date(article.createdAt).toLocaleDateString("ja-JP")}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
