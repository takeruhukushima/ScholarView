import { ArticleSummary } from "@/lib/types";

interface ArticleListProps {
  title: string;
  articles: ArticleSummary[];
  activeArticleUri: string | null;
  onOpen: (article: ArticleSummary) => void;
  actionLabel?: string;
  onAction?: () => void;
}

export function ArticleList({
  title,
  articles,
  activeArticleUri,
  onOpen,
  actionLabel,
  onAction,
}: ArticleListProps) {
  return (
    <section className="mt-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
        {actionLabel && onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="rounded border px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
      {articles.length === 0 ? (
        <p className="text-xs text-slate-500">No articles.</p>
      ) : (
        <ul className="space-y-1">
          {articles.map((article) => (
            <li key={article.uri}>
              <button
                type="button"
                onClick={() => onOpen(article)}
                className={`w-full rounded-md px-2 py-1.5 text-left ${
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
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
