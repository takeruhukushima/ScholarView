import Link from "next/link";

import { ArticleComposer } from "@/components/ArticleComposer";
import { LoginForm } from "@/components/LoginForm";
import { LogoutButton } from "@/components/LogoutButton";
import { buildPaperPath } from "@/lib/articles/uri";
import { getSession } from "@/lib/auth/session";
import { getAccountHandle, getRecentArticles } from "@/lib/db/queries";

function timeAgo(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

interface HomeProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function Home({ searchParams }: HomeProps) {
  const session = await getSession();
  const { q } = await searchParams;
  const query = typeof q === "string" ? q.trim() : "";

  const [articles, accountHandle] = await Promise.all([
    getRecentArticles(50, query),
    session ? getAccountHandle(session.did) : Promise.resolve(null),
  ]);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <main className="mx-auto w-full max-w-4xl px-4 py-8">
        <header className="mb-6 space-y-2">
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
            ScholarView
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            分散型の論文公開とインライン査読を、AT Protocol上で運用します。
          </p>
        </header>

        <section className="mb-6 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
          {session ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Signed in as @{accountHandle ?? session.did}
                </p>
                <LogoutButton />
              </div>
              <ArticleComposer />
            </div>
          ) : (
            <LoginForm />
          )}
        </section>

        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Local Viewer
            </h2>
            <form className="flex items-center gap-2" action="/" method="GET">
              <input
                type="text"
                name="q"
                defaultValue={query}
                placeholder="タイトル / 本文検索"
                className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm"
              >
                Search
              </button>
            </form>
          </div>

          {articles.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {query
                ? `"${query}" に一致する論文はありません。`
                : "まだ投稿がありません。最初の論文を公開してください。"}
            </p>
          ) : (
            <ul className="space-y-3">
              {articles.map((article) => (
                <li
                  key={article.uri}
                  className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3"
                >
                  <Link
                    href={buildPaperPath(article.did, article.rkey)}
                    className="text-base font-semibold text-blue-700 hover:underline dark:text-blue-400"
                  >
                    {article.title}
                  </Link>
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                    @{article.handle ?? article.authorDid}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded bg-zinc-100 px-2 py-1 dark:bg-zinc-800">
                      {article.sourceFormat}
                    </span>
                    <span className="rounded bg-zinc-100 px-2 py-1 dark:bg-zinc-800">
                      {article.broadcasted ? "broadcast:on" : "broadcast:off"}
                    </span>
                    <span className="text-zinc-500 dark:text-zinc-400">
                      {timeAgo(article.createdAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
