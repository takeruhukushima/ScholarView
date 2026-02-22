"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { ArticleComposer } from "@/components/ArticleComposer";
import type { ArticleBlock } from "@/lib/articles/blocks";
import { buildPaperPath } from "@/lib/articles/uri";
import { initializeAuth } from "@/lib/auth/browser";
import { installClientFetchBridge } from "@/lib/client/fetch-bridge";
import type { ArticleDetail } from "@/lib/types";

function blocksToContent(blocks: ArticleBlock[], sourceFormat: "markdown" | "tex"): string {
  return blocks
    .map((block) => {
      if (sourceFormat === "tex") {
        const command =
          block.level === 1
            ? "\\section"
            : block.level === 2
              ? "\\subsection"
              : "\\subsubsection";
        return `${command}{${block.heading}}\n${block.content}`;
      }

      return `${"#".repeat(block.level)} ${block.heading}\n${block.content}`;
    })
    .join("\n\n");
}

export default function EditPaperPage() {
  const params = useSearchParams();
  const did = params.get("did") ?? "";
  const rkey = params.get("rkey") ?? "";

  const [loading, setLoading] = useState(true);
  const [sessionDid, setSessionDid] = useState<string | null>(null);
  const [article, setArticle] = useState<ArticleDetail | null>(null);
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

        const response = await fetch(
          `/api/articles/${encodeURIComponent(did)}/${encodeURIComponent(rkey)}`,
          { cache: "no-store" },
        );
        const data = (await response.json()) as {
          success?: boolean;
          article?: ArticleDetail;
          error?: string;
        };

        if (!response.ok || !data.success || !data.article) {
          throw new Error(data.error ?? "Article not found");
        }

        if (!cancelled) {
          setArticle(data.article);
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

  const forbidden = useMemo(() => {
    if (!article) return false;
    return !sessionDid || sessionDid !== article.authorDid;
  }, [article, sessionDid]);

  if (loading) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-4xl px-4 py-8 text-sm text-zinc-600">
        Loading editor...
      </main>
    );
  }

  if (!article || error || forbidden) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-4xl px-4 py-8">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error ?? "You do not have permission to edit this article."}
        </div>
        <div className="mt-4">
          <Link
            href={buildPaperPath(did, rkey)}
            className="text-sm text-blue-700 hover:underline"
          >
            ← Back to article
          </Link>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <main className="mx-auto w-full max-w-4xl px-4 py-8">
        <div className="mb-4">
          <Link
            href={buildPaperPath(did, rkey)}
            className="text-sm text-blue-700 hover:underline dark:text-blue-400"
          >
            ← Back to article
          </Link>
        </div>

        <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h1 className="mb-4 text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            Edit Article
          </h1>

          <ArticleComposer
            mode="edit"
            did={did}
            rkey={rkey}
            initialTitle={article.title}
            initialSourceFormat={article.sourceFormat}
            initialContent={blocksToContent(article.blocks, article.sourceFormat)}
          />
        </section>
      </main>
    </div>
  );
}
