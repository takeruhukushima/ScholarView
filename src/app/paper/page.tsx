"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { ArticleViewer } from "@/components/ArticleViewer";
import {
  buildAtprotoAtArticleUrl,
  buildPaperEditPath,
} from "@/lib/articles/uri";
import { initializeAuth } from "@/lib/auth/browser";
import { installClientFetchBridge } from "@/lib/client/fetch-bridge";
import type { ArticleDetail, InlineCommentView } from "@/lib/types";

interface DiscussionPayload {
  success?: boolean;
  thread?: Array<{
    uri?: string;
    authorDid?: string;
    handle?: string | null;
    text?: string;
    quote?: string;
    externalUri?: string;
    createdAt?: string;
  }>;
}

function PaperPageClient() {
  const params = useSearchParams();
  const did = params.get("did") ?? "";
  const rkey = params.get("rkey") ?? "";
  const initialQuote = params.get("quote");

  const [loading, setLoading] = useState(true);
  const [sessionDid, setSessionDid] = useState<string | null>(null);
  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [comments, setComments] = useState<InlineCommentView[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    installClientFetchBridge();
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      installClientFetchBridge();

      if (!did || !rkey) {
        setError("Missing article parameters");
        setLoading(false);
        return;
      }

      try {
        const auth = await initializeAuth();
        if (cancelled) return;
        setSessionDid(auth.did);

        const [articleRes, discussionRes] = await Promise.all([
          fetch(`/api/articles/${encodeURIComponent(did)}/${encodeURIComponent(rkey)}`, {
            cache: "no-store",
          }),
          fetch(
            `/api/articles/${encodeURIComponent(did)}/${encodeURIComponent(
              rkey,
            )}/discussion`,
            { cache: "no-store" },
          ),
        ]);

        const articleData = (await articleRes.json()) as {
          success?: boolean;
          article?: ArticleDetail;
          error?: string;
        };
        const discussionData = (await discussionRes.json()) as DiscussionPayload;

        if (!articleRes.ok || !articleData.success || !articleData.article) {
          throw new Error(articleData.error ?? "Article not found");
        }
        const articleRecord = articleData.article;

        const discussionComments: InlineCommentView[] = (discussionData.thread ?? [])
          .filter((post) => typeof post.uri === "string")
          .map((post) => ({
            uri: post.uri ?? "",
            articleUri: articleRecord.uri,
            authorDid: typeof post.authorDid === "string" ? post.authorDid : "",
            handle: typeof post.handle === "string" ? post.handle : null,
            text: typeof post.text === "string" ? post.text : "",
            quote: typeof post.quote === "string" ? post.quote : "",
            externalUri: typeof post.externalUri === "string" ? post.externalUri : "",
            createdAt:
              typeof post.createdAt === "string"
                ? post.createdAt
                : new Date().toISOString(),
          }));

        if (!cancelled) {
          setArticle(articleRecord);
          setComments(discussionComments);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load article");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [did, rkey]);

  if (loading) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-4xl px-4 py-8 text-sm text-zinc-600">
        Loading article...
      </main>
    );
  }

  if (!article || error) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-4xl px-4 py-8">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error ?? "Article not found"}
        </div>
        <div className="mt-4">
          <Link href="/" className="text-sm text-blue-700 hover:underline">
            ← Back to workspace
          </Link>
        </div>
      </main>
    );
  }

  const canEdit = sessionDid === article.authorDid;
  const canComment = Boolean(sessionDid && article.announcementUri);
  const canonicalUrl = buildAtprotoAtArticleUrl(article.did, article.rkey);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <main className="mx-auto w-full max-w-4xl px-4 py-8">
        <div className="mb-4">
          <Link href="/" className="text-sm text-blue-700 hover:underline dark:text-blue-400">
            ← Back to feed
          </Link>
        </div>

        <div className="mb-4 rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          <p>
            Canonical:{" "}
            <a
              href={canonicalUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="break-all text-blue-700 hover:underline dark:text-blue-400"
            >
              {canonicalUrl}
            </a>
          </p>
        </div>

        <ArticleViewer
          did={article.did}
          rkey={article.rkey}
          title={article.title}
          authors={article.authors}
          blocks={article.blocks}
          bibliography={article.bibliography}
          comments={comments}
          canComment={canComment}
          canEdit={canEdit}
          editHref={buildPaperEditPath(article.did, article.rkey)}
          initialHighlightQuote={initialQuote}
        />
      </main>
    </div>
  );
}

export default function PaperPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto min-h-screen w-full max-w-4xl px-4 py-8 text-sm text-zinc-600">
          Loading article...
        </main>
      }
    >
      <PaperPageClient />
    </Suspense>
  );
}
