import Link from "next/link";
import { notFound } from "next/navigation";

import { ArticleComposer } from "@/components/ArticleComposer";
import type { ArticleBlock } from "@/lib/articles/blocks";
import { buildPaperPath, decodeRouteParam } from "@/lib/articles/uri";
import { getSession } from "@/lib/auth/session";
import { getArticleByDidAndRkey } from "@/lib/db/queries";

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

interface EditPageProps {
  params: Promise<{ did: string; rkey: string }>;
}

export default async function EditPage({ params }: EditPageProps) {
  const route = await params;
  const did = decodeRouteParam(route.did);
  const rkey = decodeRouteParam(route.rkey);

  const [session, article] = await Promise.all([
    getSession(),
    getArticleByDidAndRkey(did, rkey),
  ]);

  if (!article) {
    notFound();
  }

  if (!session || session.did !== article.authorDid) {
    notFound();
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

        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
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
