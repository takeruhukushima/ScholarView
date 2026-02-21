import Link from "next/link";
import { notFound } from "next/navigation";

import { ArticleViewer } from "@/components/ArticleViewer";
import {
  buildAtprotoAtArticleUrl,
  buildPaperPath,
  decodeRouteParam,
} from "@/lib/articles/uri";
import { getSession } from "@/lib/auth/session";
import {
  getArticleByDidAndRkey,
  getInlineCommentsByArticle,
} from "@/lib/db/queries";

interface PaperPageProps {
  params: Promise<{ did: string; rkey: string }>;
  searchParams: Promise<{ quote?: string }>;
}

export default async function PaperPage({ params, searchParams }: PaperPageProps) {
  const route = await params;
  const query = await searchParams;

  const did = decodeRouteParam(route.did);
  const rkey = decodeRouteParam(route.rkey);

  const article = await getArticleByDidAndRkey(did, rkey);
  if (!article) {
    notFound();
  }

  const [session, comments] = await Promise.all([
    getSession(),
    getInlineCommentsByArticle(article.uri),
  ]);

  const initialQuote = typeof query.quote === "string" ? query.quote : null;
  const canEdit = session?.did === article.authorDid;
  const canComment = Boolean(session && article.announcementUri);
  const canonicalUrl = buildAtprotoAtArticleUrl(article.did, article.rkey);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <main className="mx-auto w-full max-w-4xl px-4 py-8">
        <div className="mb-4">
          <Link href="/" className="text-sm text-blue-700 hover:underline dark:text-blue-400">
            ← Back to feed
          </Link>
        </div>

        <div className="mb-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 text-sm text-zinc-600 dark:text-zinc-300">
          <p>Author: @{article.handle ?? article.authorDid}</p>
          <p className="mt-1">
            Canonical:{" "}
            <a
              href={canonicalUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-blue-700 hover:underline dark:text-blue-400 break-all"
            >
              {canonicalUrl}
            </a>
          </p>
        </div>

        <ArticleViewer
          did={article.did}
          rkey={article.rkey}
          title={article.title}
          blocks={article.blocks}
          bibliography={article.bibliography}
          comments={comments}
          canComment={canComment}
          canEdit={canEdit}
          editHref={`${buildPaperPath(article.did, article.rkey)}/edit`}
          initialHighlightQuote={initialQuote}
        />
      </main>
    </div>
  );
}
