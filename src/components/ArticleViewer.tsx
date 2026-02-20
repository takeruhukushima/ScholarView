"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { ArticleBlock } from "@/lib/articles/blocks";
import type { InlineCommentView } from "@/lib/db/queries";

import { InlineCommentComposer } from "./InlineCommentComposer";

interface ArticleViewerProps {
  did: string;
  rkey: string;
  title: string;
  blocks: ArticleBlock[];
  comments: InlineCommentView[];
  canComment: boolean;
  initialHighlightQuote: string | null;
}

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

function renderWithHighlight(content: string, quote: string | null) {
  if (!quote) return content;
  const idx = content.indexOf(quote);
  if (idx === -1) return content;

  return (
    <>
      {content.slice(0, idx)}
      <mark className="rounded bg-amber-200/70 px-0.5 text-inherit dark:bg-amber-700/40">
        {quote}
      </mark>
      {content.slice(idx + quote.length)}
    </>
  );
}

function headingClass(level: number): string {
  if (level === 1) return "text-2xl font-bold";
  if (level === 2) return "text-xl font-semibold";
  if (level === 3) return "text-lg font-semibold";
  return "text-base font-semibold";
}

export function ArticleViewer({
  did,
  rkey,
  title,
  blocks,
  comments,
  canComment,
  initialHighlightQuote,
}: ArticleViewerProps) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedQuote, setSelectedQuote] = useState<string | null>(null);

  const effectiveHighlight = selectedQuote ?? initialHighlightQuote;

  const dedupedComments = useMemo(() => {
    const seen = new Set<string>();
    return comments.filter((comment) => {
      if (seen.has(comment.uri)) return false;
      seen.add(comment.uri);
      return true;
    });
  }, [comments]);

  function handleMouseUp() {
    if (!canComment) return;

    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (!selection || !text) return;

    const anchorNode = selection.anchorNode;
    if (!anchorNode) return;

    if (!containerRef.current?.contains(anchorNode)) {
      return;
    }

    setSelectedQuote(text.slice(0, 280));
  }

  return (
    <div className="space-y-6">
      <article
        ref={containerRef}
        onMouseUp={handleMouseUp}
        className="space-y-6 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6"
      >
        <header className="space-y-2 border-b border-zinc-200 dark:border-zinc-800 pb-4">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            {title}
          </h1>
          {canComment ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              本文テキストを選択すると、インラインコメントを投稿できます。
            </p>
          ) : null}
        </header>

        <div className="space-y-5">
          {blocks.map((block, idx) => (
            <section key={`${block.heading}-${idx}`} className="space-y-2">
              <h2 className={`${headingClass(block.level)} text-zinc-900 dark:text-zinc-100`}>
                {block.heading}
              </h2>
              <p className="whitespace-pre-wrap leading-7 text-zinc-700 dark:text-zinc-300">
                {renderWithHighlight(block.content, effectiveHighlight)}
              </p>
            </section>
          ))}
        </div>
      </article>

      {selectedQuote && canComment ? (
        <InlineCommentComposer
          did={did}
          rkey={rkey}
          quote={selectedQuote}
          onSubmitted={() => {
            setSelectedQuote(null);
            router.refresh();
          }}
        />
      ) : null}

      <section className="space-y-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Inline Discussion
        </h2>

        {dedupedComments.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            まだコメントはありません。
          </p>
        ) : (
          <ul className="space-y-3">
            {dedupedComments.map((comment) => (
              <li
                key={comment.uri}
                className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3"
              >
                <p className="mb-2 rounded bg-amber-50 px-2 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  {comment.quote}
                </p>
                <p className="whitespace-pre-wrap text-sm text-zinc-900 dark:text-zinc-100">
                  {comment.text}
                </p>
                <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                  @{comment.handle ?? comment.authorDid} · {timeAgo(comment.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
