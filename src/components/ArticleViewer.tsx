"use client";

import Link from "next/link";
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
  canEdit: boolean;
  editHref: string;
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

function renderInlineMarkdown(text: string, keyPrefix: string) {
  const nodes: React.ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let last = 0;
  let idx = 0;

  for (;;) {
    const match = regex.exec(text);
    if (!match) break;

    const before = text.slice(last, match.index);
    if (before) {
      nodes.push(<span key={`${keyPrefix}-t-${idx++}`}>{before}</span>);
    }

    nodes.push(
      <strong key={`${keyPrefix}-b-${idx++}`} className="font-semibold">
        {match[1]}
      </strong>,
    );

    last = match.index + match[0].length;
  }

  const rest = text.slice(last);
  if (rest) {
    nodes.push(<span key={`${keyPrefix}-t-${idx++}`}>{rest}</span>);
  }

  if (nodes.length === 0) {
    nodes.push(<span key={`${keyPrefix}-empty`}>{text}</span>);
  }

  return nodes;
}

function renderMarkdownWithHighlight(content: string, quote: string | null, keyPrefix: string) {
  const lines = content.split("\n");

  return lines.map((line, lineIdx) => {
    if (!quote) {
      return (
        <span key={`${keyPrefix}-line-${lineIdx}`}>
          {renderInlineMarkdown(line, `${keyPrefix}-line-${lineIdx}`)}
          {lineIdx < lines.length - 1 ? <br /> : null}
        </span>
      );
    }

    const pos = line.indexOf(quote);
    if (pos === -1) {
      return (
        <span key={`${keyPrefix}-line-${lineIdx}`}>
          {renderInlineMarkdown(line, `${keyPrefix}-line-${lineIdx}`)}
          {lineIdx < lines.length - 1 ? <br /> : null}
        </span>
      );
    }

    const before = line.slice(0, pos);
    const match = line.slice(pos, pos + quote.length);
    const after = line.slice(pos + quote.length);

    return (
      <span key={`${keyPrefix}-line-${lineIdx}`}>
        {before ? renderInlineMarkdown(before, `${keyPrefix}-line-${lineIdx}-before`) : null}
        <mark className="rounded bg-amber-200/70 px-0.5 text-inherit dark:bg-amber-700/40">
          {renderInlineMarkdown(match, `${keyPrefix}-line-${lineIdx}-mark`)}
        </mark>
        {after ? renderInlineMarkdown(after, `${keyPrefix}-line-${lineIdx}-after`) : null}
        {lineIdx < lines.length - 1 ? <br /> : null}
      </span>
    );
  });
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
  canEdit,
  editHref,
  initialHighlightQuote,
}: ArticleViewerProps) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedQuote, setSelectedQuote] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  async function handleDelete() {
    if (!canEdit || deleting) return;

    const ok = window.confirm("この論文を削除します。よろしいですか？");
    if (!ok) return;

    setDeleting(true);
    setDeleteError(null);

    try {
      const response = await fetch(
        `/api/articles/${encodeURIComponent(did)}/${encodeURIComponent(rkey)}`,
        { method: "DELETE" },
      );

      const data = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to delete article");
      }

      router.push("/");
      router.refresh();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete article");
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <article
        ref={containerRef}
        onMouseUp={handleMouseUp}
        className="space-y-6 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6"
      >
        <header className="space-y-2 border-b border-zinc-200 dark:border-zinc-800 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
              {title}
            </h1>
            {canEdit ? (
              <div className="flex items-center gap-2">
                <Link
                  href={editHref}
                  className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm"
                >
                  Edit
                </Link>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 disabled:opacity-50"
                >
                  {deleting ? "Deleting..." : "Delete"}
                </button>
              </div>
            ) : null}
          </div>

          {canComment ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              本文テキストを選択すると、インラインコメントを投稿できます。
            </p>
          ) : (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              この論文は告知投稿がないため、Bluesky連携コメントは利用できません。
            </p>
          )}

          {deleteError ? <p className="text-sm text-red-600">{deleteError}</p> : null}
        </header>

        <div className="space-y-5">
          {blocks.map((block, idx) => (
            <section key={`${block.heading}-${idx}`} className="space-y-2">
              <h2 className={`${headingClass(block.level)} text-zinc-900 dark:text-zinc-100`}>
                {block.heading}
              </h2>
              <p className="whitespace-pre-wrap leading-7 text-zinc-700 dark:text-zinc-300">
                {renderMarkdownWithHighlight(
                  block.content,
                  effectiveHighlight,
                  `block-${idx}`,
                )}
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
                {comment.quote ? (
                  <p className="mb-2 rounded bg-amber-50 px-2 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {comment.quote}
                  </p>
                ) : (
                  <p className="mb-2 inline-flex rounded border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                    Bsky返信（引用なし）
                  </p>
                )}
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
