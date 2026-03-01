"use client";

import Link from "next/link";
import { useMemo, useRef, useState, Fragment } from "react";
import { useRouter } from "next/navigation";
import katex from "katex";

import type { ArticleBlock } from "@/lib/articles/blocks";
import {
  formatBibliographyIEEE,
  formatCitationChip,
  type BibliographyEntry,
} from "@/lib/articles/citations";
import type { ArticleAuthor, InlineCommentView } from "@/lib/types";

import { InlineCommentComposer } from "./InlineCommentComposer";

interface ArticleViewerProps {
  did: string;
  rkey: string;
  title: string;
  authors: ArticleAuthor[];
  blocks: ArticleBlock[];
  bibliography: BibliographyEntry[];
  comments: InlineCommentView[];
  canComment: boolean;
  canEdit: boolean;
  editHref: string;
  initialHighlightQuote: string | null;
  onQuoteSelect?: (quote: string) => void;
  showComments?: boolean;
  onRefresh?: () => Promise<void>;
}

function renderMathHtml(expression: string, displayMode: boolean): string | null {
  try {
    return katex.renderToString(expression, {
      displayMode,
      throwOnError: false,
      strict: "ignore",
      output: "html",
    });
  } catch {
    return null;
  }
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

function renderInlineMarkdown(
  text: string,
  keyPrefix: string,
  bibliographyByKey: Map<string, BibliographyEntry>,
  keyToNumber: Map<string, number>,
) {
  const nodes: React.ReactNode[] = [];
  const regex = /(`[^`]+`|\\cite\{[^}]+\}|\$(?:\\.|[^$\n])+\$|\[@?([^\]]+)\]|\*\*(.+?)\*\*)/g;
  let last = 0;
  let idx = 0;

  for (;;) {
    const match = regex.exec(text);
    if (!match) break;

    const before = text.slice(last, match.index);
    if (before) {
      nodes.push(<span key={`${keyPrefix}-t-${idx++}`}>{before}</span>);
    }

    const token = match[0];
    if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(
        <strong key={`${keyPrefix}-b-${idx++}`} className="font-semibold text-slate-900">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code key={`${keyPrefix}-c-${idx++}`} className="rounded bg-slate-100 px-1 py-0.5 text-[0.9em] font-mono text-indigo-600">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("\\cite{") && token.endsWith("}") || token.startsWith("[") && token.endsWith("]")) {
      const isBrackets = token.startsWith("[");
      const content = isBrackets ? token.slice(1, -1).replace(/^@/, "") : token.slice(6, -1);
      const keys = content.split(/[,;]/).map((k) => k.trim().replace(/^@/, "")).filter(Boolean);
      
      nodes.push(
        <span key={`${keyPrefix}-q-${idx++}`} className="rounded bg-indigo-50 px-1 py-0.5 text-[0.85em] font-bold text-indigo-600 border border-indigo-100">
          {"["}
          {keys.map((k, i) => {
            const entry = bibliographyByKey.get(k);
            const num = keyToNumber.get(k);
            const label = num ? num.toString() : (entry ? formatCitationChip(entry) : k);
            return (
              <Fragment key={`${keyPrefix}-cite-${idx}-${i}`}>
                {i > 0 ? ", " : ""}
                <span title={entry?.title ?? k}>{label}</span>
              </Fragment>
            );
          })}
          {"]"}
        </span>
      );
    } else if (token.startsWith("$") && token.endsWith("$")) {
      const expr = token.slice(1, -1).trim();
      const mathHtml = renderMathHtml(expr, false);
      if (mathHtml) {
        nodes.push(
          <span
            key={`${keyPrefix}-m-${idx++}`}
            className="inline-block align-middle"
            dangerouslySetInnerHTML={{ __html: mathHtml }}
          />,
        );
      } else {
        nodes.push(
          <span
            key={`${keyPrefix}-m-${idx++}`}
            className="rounded bg-indigo-50 px-1 py-0.5 font-mono text-[0.9em] text-indigo-600 border border-indigo-100"
          >
            {expr}
          </span>,
        );
      }
    }

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

function renderMarkdownWithHighlight(
  content: string,
  quote: string | null,
  keyPrefix: string,
  bibliographyByKey: Map<string, BibliographyEntry>,
  keyToNumber: Map<string, number>,
) {
  const lines = content.split("\n");

  return lines.map((line, lineIdx) => {
    if (!quote) {
      return (
        <span key={`${keyPrefix}-line-${lineIdx}`}>
          {renderInlineMarkdown(line, `${keyPrefix}-line-${lineIdx}`, bibliographyByKey, keyToNumber)}
          {lineIdx < lines.length - 1 ? <br /> : null}
        </span>
      );
    }

    const pos = line.indexOf(quote);
    if (pos === -1) {
      return (
        <span key={`${keyPrefix}-line-${lineIdx}`}>
          {renderInlineMarkdown(line, `${keyPrefix}-line-${lineIdx}`, bibliographyByKey, keyToNumber)}
          {lineIdx < lines.length - 1 ? <br /> : null}
        </span>
      );
    }

    const before = line.slice(0, pos);
    const match = line.slice(pos, pos + quote.length);
    const after = line.slice(pos + quote.length);

    return (
      <span key={`${keyPrefix}-line-${lineIdx}`}>
        {before ? renderInlineMarkdown(before, `${keyPrefix}-line-${lineIdx}-before`, bibliographyByKey, keyToNumber) : null}
        <mark className="rounded bg-amber-200/70 px-0.5 text-inherit">
          {renderInlineMarkdown(match, `${keyPrefix}-line-${lineIdx}-mark`, bibliographyByKey, keyToNumber)}
        </mark>
        {after ? renderInlineMarkdown(after, `${keyPrefix}-line-${lineIdx}-after`, bibliographyByKey, keyToNumber) : null}
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
  authors,
  blocks,
  bibliography,
  comments,
  canComment,
  canEdit,
  editHref,
  initialHighlightQuote,
  onQuoteSelect,
  showComments = true,
  onRefresh,
}: ArticleViewerProps) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [internalSelectedQuote, setInternalSelectedQuote] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const effectiveHighlight = internalSelectedQuote ?? initialHighlightQuote;

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy URL:", err);
    }
  };
  const bibliographyByKey = useMemo(() => {
    const map = new Map<string, BibliographyEntry>();
    for (const entry of bibliography) map.set(entry.key, entry);
    return map;
  }, [bibliography]);

  const keyToNumber = useMemo(() => {
    const map = new Map<string, number>();
    bibliography.forEach((entry, i) => map.set(entry.key, i + 1));
    return map;
  }, [bibliography]);

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

    const quote = text.slice(0, 280);
    setInternalSelectedQuote(quote);
    if (onQuoteSelect) {
      onQuoteSelect(quote);
    }
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
    <div className="space-y-8">
      <article
        ref={containerRef}
        onMouseUp={handleMouseUp}
        className="space-y-10"
      >
        <header className="space-y-6" data-tour-id="publish-flow">
          <div className="space-y-4">
            <div className="flex flex-col gap-4">
              <h1 className="text-4xl font-bold tracking-tight text-slate-900 leading-[1.15]">
                {title}
              </h1>
              
              <div className="flex items-center gap-3 shrink-0">
                {onRefresh && (
                  <button
                    type="button"
                    onClick={() => {
                      void onRefresh().catch(() => {});
                    }}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-indigo-600 transition-all"
                    title="Refresh from AT Protocol"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                    </svg>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleCopyUrl}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-black uppercase tracking-widest text-slate-400 hover:bg-slate-50 hover:text-indigo-600 transition-all"
                >
                  {copied ? (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      Copied!
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                      Copy URL
                    </>
                  )}
                </button>
                {canEdit ? (
                  <div className="flex items-center gap-2">
                    <Link
                      href={editHref}
                      className="inline-flex h-8 items-center rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-black uppercase tracking-widest text-slate-400 hover:bg-slate-50 hover:text-indigo-600 transition-all"
                    >
                      Edit
                    </Link>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleting}
                      className="inline-flex h-8 items-center rounded-lg border border-red-100 bg-white px-3 text-[11px] font-black uppercase tracking-widest text-red-400 hover:bg-red-50 hover:text-red-600 transition-all disabled:opacity-50"
                    >
                      {deleting ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            {authors.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {authors.map((author, idx) => (
                  <span key={`${author.name}-${idx}`} className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-600 border border-slate-100">
                    <span>{author.name || "Anonymous"}</span>
                    {author.affiliation && (
                      <span className="opacity-60 font-normal">({author.affiliation})</span>
                    )}
                    {author.did && (
                      <Link
                        href={`https://bsky.app/profile/${author.did}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-indigo-600 hover:underline ml-0.5"
                      >
                        [Bsky]
                      </Link>
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-indigo-50 bg-indigo-50/30 px-3 py-2 text-[11px] font-medium text-indigo-900/60">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            {canComment ? (
              <span>Select text to initiate contextual discussion or post inline comments.</span>
            ) : (
              <span>Bluesky discussion is not available for this article.</span>
            )}
          </div>

          {deleteError ? <p className="text-xs font-bold text-red-500">{deleteError}</p> : null}
        </header>

        <div className="space-y-8">
          {blocks.map((block, idx) => (
            <section key={`${block.heading}-${idx}`} className="space-y-3">
              <h2 className={`${headingClass(block.level)} text-slate-900 tracking-tight`}>
                {block.heading}
              </h2>
              <div className="text-[15px] leading-7 text-slate-700">
                {renderMarkdownWithHighlight(
                  block.content,
                  effectiveHighlight,
                  `block-${idx}`,
                  bibliographyByKey,
                  keyToNumber,
                )}
              </div>
            </section>
          ))}
        </div>
        
        {bibliography.length > 0 ? (
          <section className="mt-12 pt-8 border-t border-slate-100">
            <div className="flex items-center gap-2 mb-4 px-1">
              <div className="h-1.5 w-1.5 rounded-full bg-slate-400"></div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Bibliographic References</p>
            </div>
            <ol className="space-y-3 px-1">
              {formatBibliographyIEEE(bibliography).map((ref, idx) => (
                <li key={`${ref}-${idx}`} className="text-[12px] leading-relaxed text-slate-500 list-none pl-6 -indent-6">
                  <span className="inline-block w-6 text-slate-400 font-mono font-bold">[{idx + 1}]</span>
                  {ref.replace(/^\[\d+\]\s*/, "")}
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </article>

      {showComments && internalSelectedQuote && canComment ? (
        <div className="mt-8 rounded-2xl border border-indigo-100 bg-indigo-50/20 p-4 shadow-sm animate-in slide-in-from-bottom-4 duration-500">
          <InlineCommentComposer
            did={did}
            rkey={rkey}
            quote={internalSelectedQuote}
            onSubmitted={() => {
              setInternalSelectedQuote(null);
              if (onQuoteSelect) onQuoteSelect("");
              router.refresh();
            }}
          />
        </div>
      ) : null}

      {showComments && (
        <section className="mt-12 pt-8 border-t border-slate-100">
          <div className="flex items-center gap-2 mb-6 px-1">
            <div className="h-1.5 w-1.5 rounded-full bg-indigo-400"></div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-400">Inline Discussion</p>
          </div>

          {dedupedComments.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-100 bg-slate-50/30 py-10 text-slate-400">
              <p className="text-[11px] font-medium uppercase tracking-wider">No comments yet</p>
            </div>
          ) : (
            <ul className="space-y-4">
              {dedupedComments.map((comment) => (
                <li
                  key={comment.uri}
                  className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm"
                >
                  {comment.quote ? (
                    <p className="mb-3 italic leading-relaxed text-slate-500 px-2 border-l-2 border-indigo-100 text-xs">
                      &quot;{comment.quote}&quot;
                    </p>
                  ) : (
                    <p className="mb-3 inline-flex items-center rounded bg-slate-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-tight text-slate-400 border border-slate-100">
                      Bluesky Reply
                    </p>
                  )}
                  <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-700">
                    {comment.text}
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <div className="h-4 w-4 rounded-full bg-slate-100"></div>
                    <p className="text-[10px] font-bold text-slate-400">
                      @{comment.handle ?? comment.authorDid} <span className="mx-1 opacity-40">·</span> {timeAgo(comment.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
