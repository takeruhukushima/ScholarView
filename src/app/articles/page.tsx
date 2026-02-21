import Link from "next/link";

import { buildPaperPath } from "@/lib/articles/uri";
import { getRecentArticles } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default async function ArticlesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const articles = await getRecentArticles(300, q);

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

        <form method="GET" action="/articles" className="mb-4 flex gap-2">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search title or content..."
            className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-[#0085FF]"
          />
          <button
            type="submit"
            className="rounded-md bg-[#0085FF] px-3 py-2 text-sm font-medium text-white"
          >
            Search
          </button>
        </form>

        <p className="mb-3 text-xs text-slate-500">{articles.length} result(s)</p>
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
