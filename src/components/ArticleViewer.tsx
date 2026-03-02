"use client";

import Link from "next/link";
import { useMemo, useRef, useState, Fragment } from "react";
import { useRouter } from "next/navigation";
import katex from "katex";

import type { ArticleBlock } from "@/lib/articles/blocks";
import {
  formatCitationChip,
  formatAuthorsForReference,
  type BibliographyEntry,
} from "@/lib/articles/citations";
import { referenceAnchorId } from "@/lib/workspace/utils";
import type { ArticleAuthor, InlineCommentView, ArticleImageAsset } from "@/lib/types";

import { InlineCommentComposer } from "./InlineCommentComposer";

interface ArticleViewerProps {
  did: string;
  rkey: string;
  title: string;
  authors: ArticleAuthor[];
  blocks: ArticleBlock[];
  bibliography: BibliographyEntry[];
  images?: ArticleImageAsset[];
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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="absolute right-2 top-2 rounded bg-slate-800/50 p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white transition-all opacity-0 group-hover:opacity-100"
      title="Copy to clipboard"
    >
      {copied ? (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      )}
    </button>
  );
}

function renderInlineMarkdown(
  text: string,
  keyPrefix: string,
  bibliographyByKey: Map<string, BibliographyEntry>,
  keyToNumber: Map<string, number>,
  resolveImageUrl?: (src: string) => string | null,
  highlightQuote?: string | null,
) {
  const nodes: React.ReactNode[] = [];
  
  // If there's a highlight quote, we first split by it
  if (highlightQuote && text.includes(highlightQuote)) {
    const pos = text.indexOf(highlightQuote);
    const before = text.slice(0, pos);
    const match = text.slice(pos, pos + highlightQuote.length);
    const after = text.slice(pos + highlightQuote.length);

    if (before) {
      nodes.push(...renderInlineMarkdown(before, `${keyPrefix}-h-before`, bibliographyByKey, keyToNumber, resolveImageUrl, null));
    }
    nodes.push(
      <mark key={`${keyPrefix}-h-mark`} className="rounded bg-amber-200/70 px-0.5 text-inherit">
        {renderInlineMarkdown(match, `${keyPrefix}-h-match`, bibliographyByKey, keyToNumber, resolveImageUrl, null)}
      </mark>
    );
    if (after) {
      nodes.push(...renderInlineMarkdown(after, `${keyPrefix}-h-after`, bibliographyByKey, keyToNumber, resolveImageUrl, null));
    }
    return nodes;
  }

  const regex = /(!\[[^\]]*\]\(([^)\s]+)\)(?:\{[^}]*\})?|`[^`]+`|\\cite\{[^}]+\}|\$(?:\\.|[^$\n])+\$|\[@?([^\]]+)\]|\*\*(.+?)\*\*)/g;
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
    if (token.startsWith("![") && token.includes("](")) {
      const imgMatch = token.match(/!\[([^\]]*)\]\(([^)\s]+)\)(?:\{([^}]*)\})?/);
      if (imgMatch) {
        const alt = imgMatch[1];
        const src = imgMatch[2];
        const resolved = resolveImageUrl ? resolveImageUrl(src) : src;
        nodes.push(
          <span key={`${keyPrefix}-img-${idx++}`} className="block my-6 text-center">
            <img
              src={resolved || ""}
              alt={alt}
              className="mx-auto rounded-lg border border-slate-200 shadow-sm max-w-full"
            />
            {alt && <span className="block mt-2 text-xs text-slate-500 italic">{alt}</span>}
          </span>
        );
      }
    } else if (token.startsWith("**") && token.endsWith("**")) {
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
                {num ? (
                  <Link
                    href={`#${referenceAnchorId("cite", k)}`}
                    title={entry?.title ?? k}
                    className="hover:underline cursor-pointer"
                  >
                    {label}
                  </Link>
                ) : (
                  <span title={entry?.title ?? k}>{label}</span>
                )}
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

function renderMarkdownBlocks(
  text: string,
  quote: string | null,
  keyPrefix: string,
  bibliographyByKey: Map<string, BibliographyEntry>,
  keyToNumber: Map<string, number>,
  resolveImageUrl?: (src: string) => string | null,
) {
  const nodes: React.ReactNode[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Code blocks
    if (line.startsWith("```")) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      
      const codeContent = codeLines.join("\n").trimEnd();
      if (codeContent) {
        nodes.push(
          <div
            key={`${keyPrefix}-code-${i}`}
            className="group relative my-6 overflow-x-auto rounded-lg bg-slate-900 px-4 py-3 font-mono text-[13px] leading-relaxed text-indigo-100/90 shadow-sm"
          >
            <CopyButton text={codeContent} />
            <pre className="whitespace-pre">{codeContent}</pre>
          </div>,
        );
      }
      continue;
    }

    // Blockquotes
    if (line.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i += 1;
      }

      nodes.push(
        <blockquote
          key={`${keyPrefix}-quote-${i}`}
          className="my-6 border-l-4 border-slate-200 pl-4 italic text-slate-600"
        >
          {quoteLines.map((ql, qIdx) => (
            <p key={`${keyPrefix}-quote-line-${qIdx}`}>
              {renderInlineMarkdown(ql, `${keyPrefix}-quote-${i}-${qIdx}`, bibliographyByKey, keyToNumber, resolveImageUrl, quote)}
            </p>
          ))}
        </blockquote>,
      );
      continue;
    }

    // Regular paragraphs (grouping consecutive non-special lines)
    const paragraphLines: string[] = [];
    while (i < lines.length && lines[i].trim() && !lines[i].startsWith("```") && !lines[i].startsWith(">")) {
      paragraphLines.push(lines[i]);
      i += 1;
    }

    if (paragraphLines.length > 0) {
      nodes.push(
        <p key={`${keyPrefix}-p-${i}`} className="mb-4 last:mb-0">
          {paragraphLines.map((pl, pIdx) => (
            <Fragment key={`${keyPrefix}-p-line-${pIdx}`}>
              {renderInlineMarkdown(pl, `${keyPrefix}-p-${i}-${pIdx}`, bibliographyByKey, keyToNumber, resolveImageUrl, quote)}
              {pIdx < paragraphLines.length - 1 ? <br /> : null}
            </Fragment>
          ))}
        </p>
      );
    }
  }

  return nodes;
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
  images = [],
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
  const [copiedMd, setCopiedMd] = useState(false);

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

  const handleCopyMarkdown = async () => {
    try {
      let md = `# ${title}\n\n`;
      if (authors.length > 0) {
        const authorsStr = authors
          .map((a) => `${a.name}${a.affiliation ? ` (${a.affiliation})` : ""}`)
          .join(", ");
        md += `Authors: ${authorsStr}\n\n`;
      }
      blocks.forEach((block) => {
        md += `${"#".repeat(block.level + 1)} ${block.heading}\n\n${block.content}\n\n`;
      });
      if (bibliography.length > 0) {
        md += `\n# References\n\n\`\`\`bibtex\n`;
        bibliography.forEach((entry) => {
          md += `${entry.rawBibtex}\n\n`;
        });
        md += `\`\`\`\n`;
      }
      await navigator.clipboard.writeText(md.trim());
      setCopiedMd(true);
      setTimeout(() => setCopiedMd(false), 2000);
    } catch (err) {
      console.error("Failed to copy Markdown:", err);
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

  const resolveImageUrl = (src: string) => {
    if (!src) return null;
    if (src.startsWith("http") || src.startsWith("data:") || src.startsWith("blob:")) return src;
    
    // Resolve workspace:// or relative paths using the images array
    const cleanSrc = src.replace(/^workspace:\/\//, "").replace(/^\//, "");
    const imageAsset = images.find(img => {
      const imgPath = img.path.replace(/^workspace:\/\//, "").replace(/^\//, "");
      return imgPath === cleanSrc || img.path === src;
    });

    if (imageAsset?.blob?.ref) {
      const ref = imageAsset.blob.ref as { $link?: string; toString: () => string };
      const cid = typeof ref === "string" 
        ? ref 
        : ref.$link || ref.toString();
        
      if (cid) {
        // Use public bsky.social RPC to get the blob for guest users
        return `https://bsky.social/xrpc/com.atproto.sync.getBlob?did=${did}&cid=${cid}`;
      }
    }
    return src;
  };

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
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-indigo-600 transition-all"
                  title={copied ? "Copied URL!" : "Copy Article URL"}
                >
                  {copied ? (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleCopyMarkdown}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-indigo-600 transition-all"
                  title={copiedMd ? "Copied Markdown!" : "Copy for LLM (Markdown)"}
                >
                  {copiedMd ? (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
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
                {renderMarkdownBlocks(
                  block.content,
                  effectiveHighlight,
                  `block-${idx}`,
                  bibliographyByKey,
                  keyToNumber,
                  resolveImageUrl,
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
              {bibliography.map((entry, idx) => {
                const author = entry.author ? formatAuthorsForReference(entry.author) : "Unknown author";
                const title = entry.title ? `"${entry.title}"` : `"${entry.key}"`;
                const year = entry.year ?? "n.d.";
                return (
                  <li 
                    id={referenceAnchorId("cite", entry.key)}
                    key={`${entry.key}-${idx}`} 
                    className="text-[12px] leading-relaxed text-slate-500 list-none pl-6 -indent-6 scroll-mt-24"
                  >
                    <span className="inline-block w-6 text-slate-400 font-mono font-bold">[{idx + 1}]</span>
                    {author},{" "}
                    {entry.url ? (
                      <a 
                        href={entry.url} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="text-indigo-600 hover:underline font-medium"
                      >
                        {title}
                      </a>
                    ) : (
                      title
                    )}, {year}.
                  </li>
                );
              })}
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
