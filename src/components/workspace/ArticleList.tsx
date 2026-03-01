import { ArticleSummary } from "@/lib/types";

interface ArticleListProps {
  title: string;
  articles: ArticleSummary[];
  activeArticleUri: string | null;
  onOpen: (article: ArticleSummary) => void;
  actionLabel?: string;
  onAction?: () => void;
  onRefreshArticle?: (article: ArticleSummary) => void;
}

export function ArticleList({
  title,
  articles,
  activeArticleUri,
  onOpen,
  actionLabel,
  onAction,
  onRefreshArticle,
}: ArticleListProps) {
  return (
    <section className="mt-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
        {actionLabel && onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="rounded border px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50 transition-colors flex items-center gap-1"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
            </svg>
            {actionLabel}
          </button>
        ) : null}
      </div>
      {articles.length === 0 ? (
        <p className="text-xs text-slate-500">No articles.</p>
      ) : (
        <ul className="space-y-1">
          {articles.map((article) => (
            <li key={article.uri} className="group relative">
              <button
                type="button"
                onClick={() => onOpen(article)}
                className={`w-full rounded-md px-2 py-1.5 text-left pr-8 transition-colors ${
                  activeArticleUri === article.uri ? "bg-[#E7F2FF]" : "hover:bg-slate-100"
                }`}
              >
                <p className="truncate text-sm text-slate-800">{article.title}</p>
                {article.authors && article.authors.length > 0 && (
                  <p className="truncate text-[10px] text-slate-500">
                    {article.authors.map((a) => a.name || a.did?.slice(0, 12)).join(", ")}
                  </p>
                )}
                <p className="truncate text-[11px] text-slate-400">
                  @{article.handle ?? article.authorDid}
                </p>
              </button>
              {onRefreshArticle && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRefreshArticle(article);
                  }}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-300 opacity-0 hover:bg-white hover:text-indigo-600 group-hover:opacity-100 transition-all"
                  title="Refresh from AT Protocol"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                  </svg>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
