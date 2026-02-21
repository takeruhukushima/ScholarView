"use client";

import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { LoginForm } from "@/components/LoginForm";
import { LogoutButton } from "@/components/LogoutButton";
import type { ArticleBlock } from "@/lib/articles/blocks";
import { parseMarkdownToBlocks, parseTexToBlocks } from "@/lib/articles/blocks";
import type { SourceFormat } from "@/lib/db";
import type { ArticleSummary } from "@/lib/db/queries";

interface WorkspaceAppProps {
  initialArticles: ArticleSummary[];
  sessionDid: string | null;
  accountHandle: string | null;
}

interface WorkspaceFile {
  id: string;
  parentId: string | null;
  name: string;
  kind: "folder" | "file";
  sourceFormat: SourceFormat | null;
  content: string | null;
  linkedArticleDid: string | null;
  linkedArticleRkey: string | null;
  linkedArticleUri: string | null;
  expanded: 0 | 1;
  sortOrder: number;
}

interface DiscussionPost {
  uri: string;
  cid: string | null;
  handle: string | null;
  authorDid: string;
  text: string;
  quote: string;
  externalUri?: string;
  createdAt: string;
  parentUri: string | null;
  depth: number;
  source: "tap" | "live" | "merged";
  quoted: boolean;
  liked: boolean;
  reposted: boolean;
}

interface DiscussionRoot {
  uri: string;
  cid: string;
  text: string;
}

interface ArticleDetailPayload {
  uri: string;
  did: string;
  rkey: string;
  authorDid: string;
  title: string;
  blocks: ArticleBlock[];
  sourceFormat: SourceFormat;
  broadcasted: 0 | 1;
  announcementUri: string | null;
}

type RightTab = "preview" | "discussion";
type BlockKind = "paragraph" | "h1" | "h2" | "h3";

interface EditorBlock {
  id: string;
  kind: BlockKind;
  text: string;
}

const TUTORIAL_STORAGE_KEY = "scholarview:tutorial:v1";

function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function inferSourceFormat(name: string, current: SourceFormat | null): SourceFormat {
  if (current) return current;
  return name.toLowerCase().endsWith(".tex") ? "tex" : "markdown";
}

function defaultTitleFromFileName(name: string): string {
  const noExt = name.replace(/\.[^.]+$/, "").trim();
  return noExt || "Untitled";
}

function levelToKind(level: number): BlockKind {
  if (level <= 1) return "h1";
  if (level === 2) return "h2";
  if (level === 3) return "h3";
  return "paragraph";
}

function kindToMarkdownPrefix(kind: BlockKind): string {
  if (kind === "h1") return "# ";
  if (kind === "h2") return "## ";
  if (kind === "h3") return "### ";
  return "";
}

function kindToTexPrefix(kind: BlockKind): string {
  if (kind === "h1") return "\\section{";
  if (kind === "h2") return "\\subsection{";
  if (kind === "h3") return "\\subsubsection{";
  return "";
}

function sourceToEditorBlocks(source: string, sourceFormat: SourceFormat): EditorBlock[] {
  const blocks = sourceFormat === "tex" ? parseTexToBlocks(source) : parseMarkdownToBlocks(source);
  const editorBlocks: EditorBlock[] = [];

  for (const block of blocks) {
    if (block.heading.trim()) {
      editorBlocks.push({
        id: newId(),
        kind: levelToKind(block.level),
        text: block.heading,
      });
    }

    const paragraphs = block.content
      .split(/\n{2,}/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (paragraphs.length === 0) {
      editorBlocks.push({ id: newId(), kind: "paragraph", text: "" });
    } else {
      for (const paragraph of paragraphs) {
        editorBlocks.push({ id: newId(), kind: "paragraph", text: paragraph });
      }
    }
  }

  if (editorBlocks.length === 0) {
    editorBlocks.push({ id: newId(), kind: "paragraph", text: "" });
  }

  return editorBlocks;
}

function parseSourceToBlocks(source: string, sourceFormat: SourceFormat): ArticleBlock[] {
  return sourceFormat === "tex" ? parseTexToBlocks(source) : parseMarkdownToBlocks(source);
}

function editorBlocksToSource(blocks: EditorBlock[], sourceFormat: SourceFormat): string {
  const normalized = blocks
    .map((block) => ({ ...block, text: block.text.replace(/\r\n?/g, "\n") }))
    .filter((block) => block.text.trim().length > 0 || block.kind === "paragraph");

  if (sourceFormat === "tex") {
    return normalized
      .map((block) => {
        if (block.kind === "paragraph") {
          return block.text;
        }
        const prefix = kindToTexPrefix(block.kind);
        return `${prefix}${block.text}}`;
      })
      .join("\n\n")
      .trim();
  }

  return normalized
    .map((block) => {
      const prefix = kindToMarkdownPrefix(block.kind);
      return `${prefix}${block.text}`;
    })
    .join("\n\n")
    .trim();
}

function makeFileTree(files: WorkspaceFile[]) {
  const byParent = new Map<string | null, WorkspaceFile[]>();
  for (const file of files) {
    const siblings = byParent.get(file.parentId) ?? [];
    siblings.push(file);
    byParent.set(file.parentId, siblings);
  }

  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }

  type TreeNode = { file: WorkspaceFile; path: string; children: TreeNode[] };

  function walk(parentId: string | null, parentPath: string): TreeNode[] {
    const siblings = byParent.get(parentId) ?? [];
    return siblings.map((file) => {
      const path = `${parentPath}/${file.name}`.replace(/\/{2,}/g, "/");
      return {
        file,
        path,
        children: walk(file.id, path),
      };
    });
  }

  return walk(null, "");
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

function blockTextClass(kind: BlockKind): string {
  if (kind === "h1") return "text-3xl font-semibold leading-tight";
  if (kind === "h2") return "text-2xl font-semibold leading-tight";
  if (kind === "h3") return "text-xl font-semibold leading-tight";
  return "text-[15px] leading-6";
}

function resizeTextarea(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "0px";
  el.style.height = `${el.scrollHeight}px`;
}

function linkHref(input: string): string | null {
  try {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function renderInlineText(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokenRegex =
    /(`[^`]+`|\$\$[^$]+\$\$|\$[^$\n]+\$|\*\*[^*]+\*\*|_[^_]+_|\[[^\]]+\]\((https?:\/\/[^)\s]+)\)|https?:\/\/[^\s]+)/g;
  let cursor = 0;
  let matchIndex = 0;

  for (;;) {
    const match = tokenRegex.exec(text);
    if (!match) break;
    if (match.index > cursor) {
      nodes.push(text.slice(cursor, match.index));
    }

    const token = match[0];
    const key = `${keyPrefix}-${matchIndex}`;
    matchIndex += 1;

    if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code key={key} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.9em] text-slate-800">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("$$") && token.endsWith("$$")) {
      nodes.push(
        <span
          key={key}
          className="select-text rounded bg-blue-50 px-1.5 py-0.5 font-mono text-[0.9em] text-blue-900"
        >
          {token.slice(2, -2)}
        </span>,
      );
    } else if (token.startsWith("$") && token.endsWith("$")) {
      nodes.push(
        <span
          key={key}
          className="select-text rounded bg-blue-50 px-1.5 py-0.5 font-mono text-[0.9em] text-blue-900"
        >
          {token.slice(1, -1)}
        </span>,
      );
    } else if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("_") && token.endsWith("_")) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith("[")) {
      const linkMatch = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
      const href = linkMatch ? linkHref(linkMatch[2]) : null;
      if (linkMatch && href) {
        nodes.push(
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-[#0085FF] underline decoration-[#0085FF]/40 underline-offset-2"
          >
            {linkMatch[1]}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    } else {
      const href = linkHref(token);
      if (href) {
        nodes.push(
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-[#0085FF] underline decoration-[#0085FF]/40 underline-offset-2"
          >
            {token}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    }

    cursor = match.index + token.length;
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }

  return nodes;
}

function renderRichParagraphs(text: string, keyPrefix: string) {
  const nodes: ReactNode[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      nodes.push(
        <pre
          key={`${keyPrefix}-code-${i}`}
          className="overflow-x-auto rounded-md bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100"
        >
          {codeLines.join("\n")}
        </pre>,
      );
      continue;
    }

    if (line.startsWith("$$")) {
      const mathLines: string[] = [];
      const current = line.slice(2);
      if (current.endsWith("$$")) {
        mathLines.push(current.slice(0, -2));
        i += 1;
      } else {
        mathLines.push(current);
        i += 1;
        while (i < lines.length) {
          const candidate = lines[i];
          if (candidate.endsWith("$$")) {
            mathLines.push(candidate.slice(0, -2));
            i += 1;
            break;
          }
          mathLines.push(candidate);
          i += 1;
        }
      }

      nodes.push(
        <pre
          key={`${keyPrefix}-math-${i}`}
          className="overflow-x-auto rounded-md border border-blue-100 bg-blue-50 px-3 py-2 font-mono text-xs text-blue-900"
        >
          {mathLines.join("\n")}
        </pre>,
      );
      continue;
    }

    if (line.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i += 1;
      }

      nodes.push(
        <blockquote
          key={`${keyPrefix}-quote-${i}`}
          className="border-l-2 border-slate-300 pl-3 text-slate-600"
        >
          {quoteLines.map((quoteLine, quoteIndex) => (
            <p key={`${keyPrefix}-quote-line-${quoteIndex}`}>
              {renderInlineText(quoteLine, `${keyPrefix}-quote-inline-${quoteIndex}`)}
            </p>
          ))}
        </blockquote>,
      );
      continue;
    }

    const unorderedItems: string[] = [];
    while (i < lines.length && /^[-*+]\s+/.test(lines[i])) {
      unorderedItems.push(lines[i].replace(/^[-*+]\s+/, ""));
      i += 1;
    }
    if (unorderedItems.length > 0) {
      nodes.push(
        <ul key={`${keyPrefix}-ul-${i}`} className="list-disc space-y-1 pl-6">
          {unorderedItems.map((item, itemIndex) => (
            <li key={`${keyPrefix}-ul-item-${itemIndex}`}>
              {renderInlineText(item, `${keyPrefix}-ul-inline-${itemIndex}`)}
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    const orderedItems: string[] = [];
    while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
      orderedItems.push(lines[i].replace(/^\d+\.\s+/, ""));
      i += 1;
    }
    if (orderedItems.length > 0) {
      nodes.push(
        <ol key={`${keyPrefix}-ol-${i}`} className="list-decimal space-y-1 pl-6">
          {orderedItems.map((item, itemIndex) => (
            <li key={`${keyPrefix}-ol-item-${itemIndex}`}>
              {renderInlineText(item, `${keyPrefix}-ol-inline-${itemIndex}`)}
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    const paragraphLines: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^[-*+]\s+/.test(lines[i]) && !/^\d+\.\s+/.test(lines[i])) {
      if (lines[i].startsWith(">") || lines[i].startsWith("```") || lines[i].startsWith("$$")) {
        break;
      }
      paragraphLines.push(lines[i]);
      i += 1;
    }

    nodes.push(
      <p key={`${keyPrefix}-p-${i}`} className="whitespace-pre-wrap">
        {paragraphLines.map((paragraphLine, paragraphIndex) => (
          <Fragment key={`${keyPrefix}-p-line-${paragraphIndex}`}>
            {renderInlineText(paragraphLine, `${keyPrefix}-p-inline-${paragraphIndex}`)}
            {paragraphIndex < paragraphLines.length - 1 ? <br /> : null}
          </Fragment>
        ))}
      </p>,
    );
  }

  if (nodes.length === 0) {
    return <p className="text-sm text-slate-500">No content.</p>;
  }

  return <div className="select-text space-y-2 text-sm leading-6 text-slate-800">{nodes}</div>;
}

function blocksToSource(blocks: ArticleBlock[], sourceFormat: SourceFormat): string {
  if (sourceFormat === "tex") {
    return blocks
      .map((block) => {
        const level = block.level <= 1 ? 1 : block.level === 2 ? 2 : 3;
        const headingCommand =
          level === 1
            ? "\\section"
            : level === 2
              ? "\\subsection"
              : "\\subsubsection";
        const heading = `${headingCommand}{${block.heading}}`;
        const content = block.content.trim();
        return content ? `${heading}\n\n${content}` : heading;
      })
      .join("\n\n")
      .trim();
  }

  return blocks
    .map((block) => {
      const level = Math.max(1, Math.min(3, block.level));
      const heading = `${"#".repeat(level)} ${block.heading}`;
      const content = block.content.trim();
      return content ? `${heading}\n\n${content}` : heading;
    })
    .join("\n\n")
    .trim();
}

function FileTree({
  files,
  activeFileId,
  onSelect,
  onToggleFolder,
  onDelete,
}: {
  files: WorkspaceFile[];
  activeFileId: string | null;
  onSelect: (file: WorkspaceFile) => void;
  onToggleFolder: (file: WorkspaceFile) => void;
  onDelete: (file: WorkspaceFile) => void;
}) {
  const tree = useMemo(() => makeFileTree(files), [files]);

  const renderNode = (node: ReturnType<typeof makeFileTree>[number], depth: number) => {
    const isFolder = node.file.kind === "folder";
    const isActive = activeFileId === node.file.id;
    const expanded = node.file.expanded === 1;

    return (
      <li key={node.file.id}>
        <div
          className={`group flex items-center gap-2 rounded-md px-2 py-1 text-sm ${
            isActive ? "bg-[#E7F2FF]" : "hover:bg-slate-100"
          }`}
          style={{ paddingLeft: `${8 + depth * 14}px` }}
        >
          {isFolder ? (
            <button
              type="button"
              onClick={() => onToggleFolder(node.file)}
              className="w-4 text-xs text-slate-500"
            >
              {expanded ? "▾" : "▸"}
            </button>
          ) : (
            <span className="w-4 text-xs text-slate-400">•</span>
          )}

          <button
            type="button"
            onClick={() => onSelect(node.file)}
            className="min-w-0 flex-1 truncate text-left"
            title={node.path}
          >
            {node.file.name}
          </button>

          {node.file.kind === "file" && node.file.linkedArticleUri ? (
            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700">pub</span>
          ) : null}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(node.file);
            }}
            className="rounded px-1 text-xs text-slate-400 opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
            title={`Delete ${node.file.kind}`}
            aria-label={`Delete ${node.file.kind}`}
          >
            ×
          </button>
        </div>

        {isFolder && expanded && node.children.length > 0 ? (
          <ul className="space-y-0.5">{node.children.map((child) => renderNode(child, depth + 1))}</ul>
        ) : null}
      </li>
    );
  };

  if (tree.length === 0) {
    return <p className="text-xs text-slate-500">No files yet.</p>;
  }

  return <ul className="space-y-0.5">{tree.map((node) => renderNode(node, 0))}</ul>;
}

function ArticleList({
  title,
  articles,
  activeArticleUri,
  onOpen,
  actionLabel,
  onAction,
}: {
  title: string;
  articles: ArticleSummary[];
  activeArticleUri: string | null;
  onOpen: (article: ArticleSummary) => void;
  actionLabel?: string;
  onAction?: () => void;
}) {
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
                <p className="truncate text-[11px] text-slate-500">
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

function OnboardingTour() {
  const steps = useMemo(
    () => [
      { target: "sidebar", text: "左サイドバーでファイルを選択します。" },
      { target: "editor", text: "中央でNotion風のブロック編集を行います。" },
      { target: "publish-flow", text: "保存してからPublishするとarticleとして公開されます。" },
      { target: "right-panel", text: "右パネルでプレビューと熟議を確認します。" },
    ],
    [],
  );

  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const done = window.localStorage.getItem(TUTORIAL_STORAGE_KEY);
    if (!done) {
      const timer = window.setTimeout(() => setOpen(true), 0);
      return () => window.clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    if (!open) return;

    const updateRect = () => {
      const step = steps[stepIndex];
      if (!step) return;
      const element = document.querySelector(`[data-tour-id="${step.target}"]`);
      if (!(element instanceof HTMLElement)) {
        setRect(null);
        return;
      }
      setRect(element.getBoundingClientRect());
    };

    updateRect();
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);

    return () => {
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
    };
  }, [open, stepIndex, steps]);

  const finish = () => {
    window.localStorage.setItem(TUTORIAL_STORAGE_KEY, "done");
    setOpen(false);
    setStepIndex(0);
  };

  if (!open) return null;
  const step = steps[stepIndex];

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/45" />
      {rect ? (
        <div
          className="pointer-events-none fixed z-50 rounded-xl border-2 border-[#0085FF] shadow-[0_0_0_9999px_rgba(15,23,42,0.45)]"
          style={{
            left: rect.left - 6,
            top: rect.top - 6,
            width: rect.width + 12,
            height: rect.height + 12,
          }}
        />
      ) : null}
      <div className="fixed inset-x-4 bottom-6 z-50 mx-auto w-full max-w-xl rounded-xl border bg-white p-4 shadow-2xl">
        <p className="text-sm font-semibold text-slate-900">Tutorial {stepIndex + 1}/{steps.length}</p>
        <p className="mt-2 text-sm text-slate-600">{step.text}</p>
        <div className="mt-4 flex items-center justify-between">
          <button type="button" onClick={finish} className="text-xs text-slate-500 hover:text-slate-700">
            Skip
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStepIndex((prev) => Math.max(prev - 1, 0))}
              disabled={stepIndex === 0}
              className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-40"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => {
                if (stepIndex >= steps.length - 1) {
                  finish();
                  return;
                }
                setStepIndex((prev) => prev + 1);
              }}
              className="rounded-md bg-[#0085FF] px-3 py-1.5 text-sm text-white"
            >
              {stepIndex >= steps.length - 1 ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export function WorkspaceApp({ initialArticles, sessionDid, accountHandle }: WorkspaceAppProps) {
  const [articles, setArticles] = useState<ArticleSummary[]>(initialArticles);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [activeArticleUri, setActiveArticleUri] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [sourceFormat, setSourceFormat] = useState<SourceFormat>("markdown");
  const [editorBlocks, setEditorBlocks] = useState<EditorBlock[]>([{ id: newId(), kind: "paragraph", text: "" }]);
  const [broadcastToBsky, setBroadcastToBsky] = useState(true);

  const [currentDid, setCurrentDid] = useState<string | null>(null);
  const [currentRkey, setCurrentRkey] = useState<string | null>(null);
  const [currentAuthorDid, setCurrentAuthorDid] = useState<string | null>(null);

  const [tab, setTab] = useState<RightTab>("preview");
  const [discussionRoot, setDiscussionRoot] = useState<DiscussionRoot | null>(null);
  const [discussionPosts, setDiscussionPosts] = useState<DiscussionPost[]>([]);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [selectedQuote, setSelectedQuote] = useState("");
  const [quoteComment, setQuoteComment] = useState("");

  const [statusMessage, setStatusMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [blockMenuForId, setBlockMenuForId] = useState<string | null>(null);
  const [savingFile, setSavingFile] = useState(false);

  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const saveInFlightRef = useRef(false);
  const legacySyncRequestedRef = useRef(false);

  const articleByUri = useMemo(() => {
    const map = new Map<string, ArticleSummary>();
    for (const article of articles) map.set(article.uri, article);
    return map;
  }, [articles]);

  const activeFile = useMemo(
    () => files.find((file) => file.id === activeFileId) ?? null,
    [files, activeFileId],
  );

  const sourceText = useMemo(
    () => editorBlocksToSource(editorBlocks, sourceFormat),
    [editorBlocks, sourceFormat],
  );

  const previewBlocks = useMemo(() => parseSourceToBlocks(sourceText, sourceFormat), [
    sourceText,
    sourceFormat,
  ]);
  const myArticles = useMemo(
    () => articles.filter((article) => article.authorDid === sessionDid),
    [articles, sessionDid],
  );

  const isLoggedIn = Boolean(sessionDid);
  const isExistingArticle = Boolean(currentDid && currentRkey);
  const canEditArticle = Boolean(isLoggedIn && (!isExistingArticle || currentAuthorDid === sessionDid));
  const canEditCurrentFile = Boolean(canEditArticle && activeFile?.kind === "file");
  const hasOpenDocument = Boolean((activeFile && activeFile.kind === "file") || activeArticleUri);
  const isDirtyFile = useMemo(() => {
    if (!canEditCurrentFile || !activeFile || activeFile.kind !== "file") {
      return false;
    }
    const currentContent = activeFile.content ?? "";
    const currentFormat = activeFile.sourceFormat ?? inferSourceFormat(activeFile.name, null);
    return currentContent !== sourceText || currentFormat !== sourceFormat;
  }, [activeFile, canEditCurrentFile, sourceFormat, sourceText]);

  const readOnlyMessage = !isLoggedIn
    ? "ログインしていないため閲覧専用です。"
    : isExistingArticle && currentAuthorDid !== sessionDid
      ? "この論文は閲覧専用です（編集は作成者のみ）。"
      : isExistingArticle && !canEditCurrentFile
        ? "この投稿はワークスペースのファイルに未リンクのため閲覧専用です。"
      : null;

  const loadFiles = useCallback(async () => {
    if (!sessionDid) {
      setFiles([]);
      return [] as WorkspaceFile[];
    }

    const response = await fetch("/api/workspace/files", { cache: "no-store" });
    const data = (await response.json()) as {
      success?: boolean;
      files?: WorkspaceFile[];
      error?: string;
    };

    if (!response.ok || !data.success || !data.files) {
      throw new Error(data.error ?? "Failed to load workspace files");
    }

    setFiles(data.files);
    return data.files;
  }, [sessionDid]);

  const refreshArticles = useCallback(async () => {
    try {
      const response = await fetch("/api/articles", { cache: "no-store" });
      const data = (await response.json()) as { success?: boolean; articles?: ArticleSummary[] };
      if (response.ok && data.success && data.articles) {
        setArticles(data.articles);
      }
    } catch {
      // noop
    }
  }, []);

  const syncLegacyArticles = useCallback(
    async (options?: { force?: boolean; silent?: boolean }) => {
      if (!sessionDid) return 0;
      const force = options?.force === true;
      if (!force && legacySyncRequestedRef.current) return 0;
      if (!force) {
        legacySyncRequestedRef.current = true;
      }

      try {
        const response = await fetch("/api/workspace/sync-articles", {
          method: "POST",
          cache: "no-store",
        });
        const data = (await response.json()) as {
          success?: boolean;
          created?: number;
          error?: string;
        };
        if (!response.ok || !data.success) {
          throw new Error(data.error ?? "Failed to sync legacy articles");
        }
        const created = data.created ?? 0;
        if (created > 0) {
          await loadFiles();
        }
        if (!options?.silent) {
          setStatusMessage(
            created > 0
              ? `Linked ${created} article(s) to the file tree`
              : "No unlinked articles found",
          );
        }
        return created;
      } catch (err: unknown) {
        setStatusMessage(err instanceof Error ? err.message : "Failed to sync legacy articles");
        return 0;
      }
    },
    [loadFiles, sessionDid],
  );

  const openFile = useCallback(
    async (file: WorkspaceFile) => {
      setActiveFileId(file.id);
      setActiveArticleUri(file.linkedArticleUri ?? null);

      if (file.kind !== "file") {
        return;
      }

      const format = inferSourceFormat(file.name, file.sourceFormat);
      setSourceFormat(format);
      setEditorBlocks(sourceToEditorBlocks(file.content ?? "", format));

      const linked = file.linkedArticleUri ? articleByUri.get(file.linkedArticleUri) : undefined;
      if (linked) {
        setCurrentDid(linked.did);
        setCurrentRkey(linked.rkey);
        setCurrentAuthorDid(linked.authorDid);
        setTitle(linked.title);
        setBroadcastToBsky(Boolean(linked.announcementUri));
      } else if (file.linkedArticleDid && file.linkedArticleRkey) {
        setCurrentDid(file.linkedArticleDid);
        setCurrentRkey(file.linkedArticleRkey);
        setCurrentAuthorDid(sessionDid ?? null);
        setTitle(defaultTitleFromFileName(file.name));
        setBroadcastToBsky(true);
      } else {
        setCurrentDid(null);
        setCurrentRkey(null);
        setCurrentAuthorDid(sessionDid ?? null);
        setTitle(defaultTitleFromFileName(file.name));
        setBroadcastToBsky(true);
      }

      setSelectedQuote("");
      setQuoteComment("");
      setShowMoreMenu(false);
      setActiveBlockId(null);
      setBlockMenuForId(null);
      setStatusMessage("");
    },
    [articleByUri, sessionDid],
  );

  const openArticle = useCallback(
    async (article: ArticleSummary) => {
      let linkedFile = files.find(
        (file) => file.kind === "file" && file.linkedArticleUri === article.uri,
      );
      if (!linkedFile && article.authorDid === sessionDid) {
        await syncLegacyArticles({ force: true, silent: true });
        const latestFiles = await loadFiles();
        linkedFile = latestFiles.find(
          (file) => file.kind === "file" && file.linkedArticleUri === article.uri,
        );
      }
      if (linkedFile) {
        await openFile(linkedFile);
        return;
      }

      const response = await fetch(
        `/api/articles/${encodeURIComponent(article.did)}/${encodeURIComponent(article.rkey)}`,
        { cache: "no-store" },
      );
      const data = (await response.json()) as {
        success?: boolean;
        article?: Partial<ArticleDetailPayload>;
        error?: string;
      };
      if (!response.ok || !data.success || !data.article) {
        throw new Error(data.error ?? "Failed to open article");
      }

      const detail = data.article;
      const detailSourceFormat = detail.sourceFormat === "tex" ? "tex" : "markdown";
      const blocks = Array.isArray(detail.blocks) ? detail.blocks : [];
      const source = blocksToSource(blocks, detailSourceFormat);

      setActiveFileId(null);
      setActiveArticleUri(article.uri);
      setSourceFormat(detailSourceFormat);
      setEditorBlocks(sourceToEditorBlocks(source, detailSourceFormat));
      setCurrentDid(typeof detail.did === "string" ? detail.did : article.did);
      setCurrentRkey(typeof detail.rkey === "string" ? detail.rkey : article.rkey);
      setCurrentAuthorDid(
        typeof detail.authorDid === "string" ? detail.authorDid : article.authorDid,
      );
      setTitle(typeof detail.title === "string" ? detail.title : article.title);
      setBroadcastToBsky(
        detail.broadcasted === 1 ||
          (typeof detail.announcementUri === "string" && detail.announcementUri.length > 0) ||
          Boolean(article.announcementUri),
      );
      setTab("preview");
      setSelectedQuote("");
      setQuoteComment("");
      setShowMoreMenu(false);
      setActiveBlockId(null);
      setBlockMenuForId(null);
      setStatusMessage("");
    },
    [files, loadFiles, openFile, sessionDid, syncLegacyArticles],
  );

  useEffect(() => {
    void loadFiles().catch((err: unknown) => {
      setStatusMessage(err instanceof Error ? err.message : "Failed to load files");
    });
  }, [loadFiles]);

  useEffect(() => {
    void syncLegacyArticles({ silent: true });
  }, [syncLegacyArticles]);

  useEffect(() => {
    for (const block of editorBlocks) {
      resizeTextarea(textareaRefs.current[block.id] ?? null);
    }
  }, [editorBlocks]);

  const loadDiscussion = useCallback(async () => {
    if (!currentDid || !currentRkey) {
      setDiscussionRoot(null);
      setDiscussionPosts([]);
      return;
    }

    const query = selectedQuote ? `?quote=${encodeURIComponent(selectedQuote)}` : "";
    const response = await fetch(
      `/api/articles/${encodeURIComponent(currentDid)}/${encodeURIComponent(currentRkey)}/discussion${query}`,
      { cache: "no-store" },
    );

    const data = (await response.json()) as {
      success?: boolean;
      root?: DiscussionRoot | null;
      thread?: Array<Partial<DiscussionPost>>;
    };

    if (!response.ok || !data.success) {
      throw new Error("Failed to load discussion");
    }

    setDiscussionRoot(data.root ?? null);
    const normalizedThread = (data.thread ?? []).map((post) => ({
      uri: typeof post.uri === "string" ? post.uri : "",
      cid: typeof post.cid === "string" ? post.cid : null,
      handle: typeof post.handle === "string" ? post.handle : null,
      authorDid: typeof post.authorDid === "string" ? post.authorDid : "",
      text: typeof post.text === "string" ? post.text : "",
      quote: typeof post.quote === "string" ? post.quote : "",
      externalUri: typeof post.externalUri === "string" ? post.externalUri : "",
      createdAt:
        typeof post.createdAt === "string" ? post.createdAt : new Date().toISOString(),
      parentUri: typeof post.parentUri === "string" ? post.parentUri : null,
      depth: typeof post.depth === "number" ? Math.max(0, post.depth) : 1,
      source:
        post.source === "tap" || post.source === "live" || post.source === "merged"
          ? post.source
          : "tap",
      quoted: post.quoted === true,
      liked: post.liked === true,
      reposted: post.reposted === true,
    }));
    setDiscussionPosts(normalizedThread.filter((post) => post.uri));
  }, [currentDid, currentRkey, selectedQuote]);

  useEffect(() => {
    if (tab !== "discussion") return;
    void loadDiscussion().catch((err: unknown) => {
      setStatusMessage(err instanceof Error ? err.message : "Failed to load discussion");
    });
  }, [loadDiscussion, tab]);

  const createWorkspaceItem = async (kind: "folder" | "file") => {
    if (!sessionDid) {
      throw new Error("Login required");
    }

    const name = window.prompt(kind === "folder" ? "Folder name" : "File name");
    if (!name) return;

    const parentId = activeFile?.kind === "folder" ? activeFile.id : activeFile?.parentId ?? null;

    const response = await fetch("/api/workspace/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentId, name, kind }),
    });

    const data = (await response.json()) as {
      success?: boolean;
      file?: WorkspaceFile;
      error?: string;
    };

    if (!response.ok || !data.success || !data.file) {
      throw new Error(data.error ?? "Failed to create item");
    }

    await loadFiles();
    await openFile(data.file);
  };

  const saveCurrentFile = useCallback(async (options?: { silent?: boolean }) => {
    if (!canEditCurrentFile || !activeFile || activeFile.kind !== "file") {
      return null;
    }
    if (saveInFlightRef.current) {
      return null;
    }

    saveInFlightRef.current = true;
    setSavingFile(true);

    try {
      const response = await fetch(`/api/workspace/files/${encodeURIComponent(activeFile.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: sourceText,
          sourceFormat,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        file?: WorkspaceFile;
        error?: string;
      };

      if (!response.ok || !data.success || !data.file) {
        throw new Error(data.error ?? "Failed to save file");
      }

      setFiles((prev) => prev.map((item) => (item.id === data.file?.id ? data.file : item)));
      if (!options?.silent) {
        setStatusMessage(`Saved ${data.file.name}`);
      }
      return data.file;
    } finally {
      saveInFlightRef.current = false;
      setSavingFile(false);
    }
  }, [activeFile, canEditCurrentFile, sourceFormat, sourceText]);

  useEffect(() => {
    if (!isDirtyFile || !canEditCurrentFile) return;

    const timer = window.setTimeout(() => {
      void saveCurrentFile({ silent: true }).catch((err: unknown) => {
        setStatusMessage(err instanceof Error ? err.message : "Failed to autosave file");
      });
    }, 800);

    return () => window.clearTimeout(timer);
  }, [canEditCurrentFile, isDirtyFile, saveCurrentFile]);

  const handlePublish = async () => {
    if (!canEditCurrentFile || !activeFile || activeFile.kind !== "file") {
      setStatusMessage("Select a file and ensure you have edit permission.");
      return;
    }

    if (!title.trim()) {
      setStatusMessage("Title is required.");
      return;
    }

    setBusy(true);
    try {
      await saveCurrentFile({ silent: true });

      const response = await fetch(
        `/api/workspace/files/${encodeURIComponent(activeFile.id)}/publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            broadcastToBsky,
          }),
        },
      );

      const data = (await response.json()) as {
        success?: boolean;
        did?: string;
        rkey?: string;
        uri?: string;
        broadcasted?: 0 | 1;
        file?: WorkspaceFile;
        diagnostics?: Array<{ code: string; path: string; message: string }>;
        error?: string;
      };

      if (!response.ok || !data.success || !data.did || !data.rkey) {
        throw new Error(data.error ?? "Failed to publish file");
      }

      setCurrentDid(data.did);
      setCurrentRkey(data.rkey);
      setActiveArticleUri(data.uri ?? null);
      setCurrentAuthorDid(sessionDid ?? null);
      setBroadcastToBsky(data.broadcasted === 1);
      if (data.file) {
        setFiles((prev) => prev.map((item) => (item.id === data.file?.id ? data.file : item)));
      }

      await refreshArticles();
      if (tab === "discussion") {
        await loadDiscussion();
      }

      if (data.diagnostics && data.diagnostics.length > 0) {
        setStatusMessage(`Published with ${data.diagnostics.length} import warning(s).`);
      } else {
        setStatusMessage("Published article.");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleUnpublish = async () => {
    if (!canEditCurrentFile || !currentDid || !currentRkey) {
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(
        `/api/articles/${encodeURIComponent(currentDid)}/${encodeURIComponent(currentRkey)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            sourceFormat,
            broadcastToBsky: false,
            ...(sourceFormat === "tex" ? { tex: sourceText } : { markdown: sourceText }),
          }),
        },
      );

      const data = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "Failed to unpublish article");
      }

      setBroadcastToBsky(false);
      setStatusMessage("Unpublished from Bluesky.");
    } finally {
      setBusy(false);
    }
  };

  const submitInlineComment = async () => {
    if (!sessionDid) {
      setStatusMessage("Login required to comment.");
      return;
    }
    if (!currentDid || !currentRkey) {
      setStatusMessage("Publish article before commenting.");
      return;
    }
    if (!selectedQuote.trim() || !quoteComment.trim()) {
      setStatusMessage("Quote and comment text are required.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(
        `/api/articles/${encodeURIComponent(currentDid)}/${encodeURIComponent(currentRkey)}/comments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quote: selectedQuote, text: quoteComment }),
        },
      );

      const data = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "Failed to post comment");
      }

      setQuoteComment("");
      setTab("discussion");
      await loadDiscussion();
      setStatusMessage("Posted inline discussion comment.");
    } finally {
      setBusy(false);
    }
  };

  const runEngagement = async (
    action: "like" | "repost" | "reply",
    post: DiscussionPost,
    text?: string,
  ) => {
    if (!sessionDid) {
      setStatusMessage("Login required.");
      return;
    }

    const response = await fetch("/api/bsky/engagement", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, uri: post.uri, cid: post.cid, text }),
    });

    const data = (await response.json()) as { success?: boolean; error?: string };
    if (!response.ok || !data.success) {
      throw new Error(data.error ?? "Failed to send engagement");
    }

    if (action === "reply") {
      setReplyDrafts((prev) => ({ ...prev, [post.uri]: "" }));
    }

    await loadDiscussion();
  };

  const updateBlock = (id: string, patch: Partial<EditorBlock>) => {
    setEditorBlocks((prev) => prev.map((block) => (block.id === id ? { ...block, ...patch } : block)));
  };

  const insertBlockAfter = (index: number, kind: BlockKind = "paragraph") => {
    const block = { id: newId(), kind, text: "" };
    setEditorBlocks((prev) => {
      const next = [...prev];
      next.splice(index + 1, 0, block);
      return next;
    });

    window.setTimeout(() => {
      textareaRefs.current[block.id]?.focus();
      resizeTextarea(textareaRefs.current[block.id] ?? null);
    }, 0);
  };

  const removeBlock = (index: number) => {
    setEditorBlocks((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((_, idx) => idx !== index);
      const fallback = next[Math.max(0, index - 1)];
      window.setTimeout(() => {
        if (fallback) {
          textareaRefs.current[fallback.id]?.focus();
        }
      }, 0);
      return next;
    });
  };

  const insertInlineMath = (blockId: string) => {
    const target = textareaRefs.current[blockId];
    if (!target) return;
    const start = target.selectionStart;
    const end = target.selectionEnd;

    setEditorBlocks((prev) =>
      prev.map((block) => {
        if (block.id !== blockId) return block;
        const before = block.text.slice(0, start);
        const selected = block.text.slice(start, end);
        const after = block.text.slice(end);
        if (selected.length > 0) {
          return { ...block, text: `${before}$${selected}$${after}` };
        }
        return { ...block, text: `${before}$$${after}` };
      }),
    );

    window.setTimeout(() => {
      const textarea = textareaRefs.current[blockId];
      if (!textarea) return;
      if (end > start) {
        textarea.focus();
        textarea.setSelectionRange(start + 1, end + 1);
        return;
      }
      textarea.focus();
      textarea.setSelectionRange(start + 1, start + 1);
    }, 0);
  };

  const captureWindowSelection = () => {
    const selection = window.getSelection();
    if (!selection) return;
    const quote = selection.toString().trim();
    if (!quote) return;
    setSelectedQuote(quote.slice(0, 280));
  };

  const shouldShowStatus = Boolean(
    statusMessage &&
      /failed|required|forbidden|unauthorized|error|invalid|not found|can't|cannot/i.test(
        statusMessage,
      ),
  );

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_right,_#E9F4FF_0%,_#F8FAFC_45%)] p-4 md:p-6">
      <OnboardingTour />

      <header className="mb-4 rounded-xl border bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">ScholarView Workspace</h1>
            <p className="text-sm text-slate-500">{"File -> Edit -> Publish workflow"}</p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/articles"
              className="rounded-md border px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              aria-label="Search all articles"
              title="Search all articles"
            >
              ⌕
            </Link>
            <button
              type="button"
              onClick={() => {
                window.localStorage.removeItem(TUTORIAL_STORAGE_KEY);
                window.location.reload();
              }}
              className="rounded-md border px-3 py-1.5 text-sm"
            >
              Show Tutorial
            </button>
          </div>
        </div>
      </header>

      {shouldShowStatus ? (
        <p className="mb-3 rounded-md border bg-white px-3 py-2 text-sm text-slate-600">{statusMessage}</p>
      ) : null}

      <div className="grid min-h-[calc(100vh-10rem)] grid-cols-1 gap-4 lg:grid-cols-[280px_1fr_360px]">
        <aside data-tour-id="sidebar" className="rounded-xl border bg-white p-3 shadow-sm">
          <section className="mb-4 rounded-lg border bg-slate-50 p-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Account</h2>
            {sessionDid ? (
              <div className="mt-2 space-y-1">
                <p className="text-sm text-slate-700">@{accountHandle ?? sessionDid}</p>
                <LogoutButton />
              </div>
            ) : (
              <div className="mt-2">
                <LoginForm />
              </div>
            )}
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Files</h2>
              {sessionDid ? (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      void createWorkspaceItem("folder").catch((err: unknown) => {
                        setStatusMessage(err instanceof Error ? err.message : "Failed to create folder");
                      });
                    }}
                    className="rounded border px-2 py-0.5 text-xs"
                  >
                    +Dir
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void createWorkspaceItem("file").catch((err: unknown) => {
                        setStatusMessage(err instanceof Error ? err.message : "Failed to create file");
                      });
                    }}
                    className="rounded border px-2 py-0.5 text-xs"
                  >
                    +File
                  </button>
                </div>
              ) : null}
            </div>

            {sessionDid ? (
              <FileTree
                files={files}
                activeFileId={activeFileId}
                onSelect={(file) => {
                  void openFile(file).catch((err: unknown) => {
                    setStatusMessage(err instanceof Error ? err.message : "Failed to open file");
                  });
                }}
                onToggleFolder={(file) => {
                  void fetch(`/api/workspace/files/${encodeURIComponent(file.id)}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ expanded: file.expanded === 1 ? 0 : 1 }),
                  })
                    .then(() => loadFiles())
                    .catch((err: unknown) => {
                      setStatusMessage(err instanceof Error ? err.message : "Failed to toggle folder");
                    });
                }}
                onDelete={(file) => {
                  const label = file.kind === "folder" ? "folder and all children" : "file";
                  const confirmed = window.confirm(`Delete this ${label}?`);
                  if (!confirmed) return;

                  void fetch(`/api/workspace/files/${encodeURIComponent(file.id)}`, {
                    method: "DELETE",
                  })
                    .then(async (response) => {
                      const data = (await response.json()) as { success?: boolean; error?: string };
                      if (!response.ok || !data.success) {
                        throw new Error(data.error ?? "Failed to delete item");
                      }
                      const latestFiles = await loadFiles();
                      if (
                        activeFileId &&
                        !latestFiles.some((item) => item.id === activeFileId)
                      ) {
                        setActiveFileId(null);
                        if (!activeArticleUri) {
                          setCurrentDid(null);
                          setCurrentRkey(null);
                          setEditorBlocks([{ id: newId(), kind: "paragraph", text: "" }]);
                          setTitle("");
                          setSelectedQuote("");
                          setQuoteComment("");
                        }
                      }
                    })
                    .catch((err: unknown) => {
                      setStatusMessage(err instanceof Error ? err.message : "Failed to delete item");
                    });
                }}
              />
            ) : (
              <p className="text-xs text-slate-500">Login to access your private workspace files.</p>
            )}
          </section>

          {sessionDid ? (
            <ArticleList
              title="My Articles"
              articles={myArticles}
              activeArticleUri={activeArticleUri}
              actionLabel="Link Existing"
              onAction={() => {
                void syncLegacyArticles({ force: true }).catch((err: unknown) => {
                  setStatusMessage(err instanceof Error ? err.message : "Failed to sync legacy articles");
                });
              }}
              onOpen={(article) => {
                void openArticle(article).catch((err: unknown) => {
                  setStatusMessage(err instanceof Error ? err.message : "Failed to open article");
                });
              }}
            />
          ) : null}

        </aside>

        <section data-tour-id="editor" className="rounded-xl border bg-white p-4 shadow-sm">
          {!hasOpenDocument ? (
            <div className="flex h-full min-h-[26rem] items-center justify-center rounded-xl border border-dashed text-sm text-slate-500">
              Select a file or article from the sidebar.
            </div>
          ) : (
            <>
              <div className="mb-4 flex items-start justify-between gap-3" data-tour-id="publish-flow">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  readOnly={!canEditCurrentFile}
                  className="w-full border-none bg-transparent text-3xl font-semibold outline-none"
                  placeholder="Untitled"
                />

                <div className="relative flex items-center gap-2">
                  {canEditCurrentFile ? (
                    <span className="text-xs text-slate-500">
                      {savingFile ? "Saving..." : isDirtyFile ? "Unsaved changes" : "Saved"}
                    </span>
                  ) : null}

                  {canEditCurrentFile ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        void handlePublish().catch((err: unknown) => {
                          setStatusMessage(err instanceof Error ? err.message : "Failed to publish");
                        });
                      }}
                      className="rounded-md bg-[#0085FF] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      Publish
                    </button>
                  ) : null}

                  {canEditCurrentFile ? (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setShowMoreMenu((prev) => !prev)}
                        className="rounded-md border px-3 py-2 text-sm"
                      >
                        More
                      </button>
                      {showMoreMenu ? (
                        <div className="absolute right-0 top-11 z-20 w-64 rounded-lg border bg-white p-3 shadow-lg">
                          <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Format
                            <select
                              value={sourceFormat}
                              onChange={(e) => setSourceFormat(e.target.value as SourceFormat)}
                              className="mt-1 w-full rounded-md border px-2 py-1 text-sm font-normal"
                            >
                              <option value="markdown">Markdown</option>
                              <option value="tex">TeX</option>
                            </select>
                          </label>

                          <label className="mb-2 flex items-center gap-2 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              checked={broadcastToBsky}
                              onChange={(e) => setBroadcastToBsky(e.target.checked)}
                            />
                            Bluesky Sync
                          </label>

                          {currentDid && currentRkey ? (
                            <button
                              type="button"
                              onClick={() => {
                                void handleUnpublish().catch((err: unknown) => {
                                  setStatusMessage(err instanceof Error ? err.message : "Failed to unpublish");
                                });
                              }}
                              className="rounded border border-red-300 px-2 py-1 text-xs text-red-700"
                            >
                              Unpublish
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>

              {readOnlyMessage ? (
                <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  {readOnlyMessage}
                </div>
              ) : null}

              <div className="space-y-0.5">
                {editorBlocks.map((block, index) => (
                  <div
                    key={block.id}
                    className={`group flex items-start gap-2 rounded-md px-0.5 py-0.5 ${
                      activeBlockId === block.id ? "bg-slate-50/70" : "hover:bg-slate-50/60"
                    }`}
                  >
                    <div className="relative mt-1 w-5 shrink-0">
                      {canEditCurrentFile && activeBlockId === block.id ? (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              setBlockMenuForId((prev) => (prev === block.id ? null : block.id))
                            }
                            className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                            title="Block options"
                          >
                            ⋮⋮
                          </button>
                          {blockMenuForId === block.id ? (
                            <div className="absolute left-6 top-0 z-30 w-32 rounded-md border bg-white p-1 text-xs shadow-lg">
                              {([
                                ["Text", "paragraph"],
                                ["Heading 1", "h1"],
                                ["Heading 2", "h2"],
                                ["Heading 3", "h3"],
                              ] as const).map(([label, value]) => (
                                <button
                                  key={value}
                                  type="button"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => {
                                    updateBlock(block.id, { kind: value });
                                    setBlockMenuForId(null);
                                  }}
                                  className={`block w-full rounded px-2 py-1 text-left hover:bg-slate-100 ${
                                    block.kind === value ? "text-[#0085FF]" : "text-slate-700"
                                  }`}
                                >
                                  {label}
                                </button>
                              ))}
                              <button
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  removeBlock(index);
                                  setBlockMenuForId(null);
                                }}
                                className="mt-1 block w-full rounded px-2 py-1 text-left text-red-600 hover:bg-red-50"
                              >
                                Delete
                              </button>
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <span className="block h-5 w-5" />
                      )}
                    </div>

                    <textarea
                      ref={(el) => {
                        textareaRefs.current[block.id] = el;
                        resizeTextarea(el);
                      }}
                      value={block.text}
                      readOnly={!canEditCurrentFile}
                      rows={1}
                      onFocus={() => {
                        setActiveBlockId(block.id);
                      }}
                      onChange={(e) => {
                        updateBlock(block.id, { text: e.target.value });
                        resizeTextarea(e.target);
                      }}
                      onSelect={(e) => {
                        const target = e.currentTarget;
                        const quote = target.value.slice(target.selectionStart, target.selectionEnd).trim();
                        setSelectedQuote(quote.slice(0, 280));
                      }}
                      onKeyDown={(e) => {
                        if (!canEditCurrentFile) return;

                        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "m") {
                          e.preventDefault();
                          insertInlineMath(block.id);
                          return;
                        }

                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          insertBlockAfter(index, "paragraph");
                          return;
                        }

                        if (
                          e.key === "Backspace" &&
                          block.text.length === 0 &&
                          editorBlocks.length > 1
                        ) {
                          e.preventDefault();
                          removeBlock(index);
                        }
                      }}
                      placeholder={block.kind === "paragraph" ? "Write your note..." : "Heading"}
                      className={`w-full resize-none border-none bg-transparent p-0 outline-none ${blockTextClass(
                        block.kind,
                      )} select-text`}
                    />
                  </div>
                ))}
              </div>

              {selectedQuote ? (
                <div data-tour-id="selection-hook" className="mt-3 rounded-md border bg-white p-2">
                  <p className="line-clamp-2 text-xs text-slate-600">{selectedQuote}</p>
                  <button
                    type="button"
                    onClick={() => setTab("discussion")}
                    className="mt-2 rounded bg-[#0085FF] px-2 py-1 text-xs text-white"
                  >
                    Blueskyで熟議する
                  </button>
                </div>
              ) : null}
            </>
          )}
        </section>

        <aside data-tour-id="right-panel" className="rounded-xl border bg-white p-3 shadow-sm">
          <div className="mb-3 inline-flex rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setTab("preview")}
              className={`rounded-md px-3 py-1.5 text-sm ${
                tab === "preview" ? "bg-white shadow" : "text-slate-600"
              }`}
            >
              Preview
            </button>
            <button
              type="button"
              onClick={() => setTab("discussion")}
              className={`rounded-md px-3 py-1.5 text-sm ${
                tab === "discussion" ? "bg-white shadow" : "text-slate-600"
              }`}
            >
              Discussion
            </button>
          </div>

          {tab === "preview" ? (
            <div className="space-y-3" onMouseUp={captureWindowSelection}>
              {sourceFormat === "markdown" ? (
                <>
                  <p className="text-xs text-slate-500">Markdown Preview</p>
                  <div className="rounded-md border p-3 select-text">
                    {sourceText.trim() ? (
                      renderRichParagraphs(sourceText, "md-preview")
                    ) : (
                      <p className="text-sm text-slate-500">No blocks yet.</p>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <p className="text-xs text-slate-500">TeX Preview ({previewBlocks.length} sections)</p>
                  {previewBlocks.length === 0 ? (
                    <p className="text-sm text-slate-500">No blocks yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {previewBlocks.map((block, idx) => {
                        const headingClass =
                          block.level <= 1
                            ? "text-2xl font-semibold"
                            : block.level === 2
                              ? "text-xl font-semibold"
                              : "text-lg font-semibold";
                        return (
                          <section key={`${block.heading}-${idx}`} className="rounded-md border p-3">
                            <p className={headingClass}>{block.heading}</p>
                            <div className="mt-2">{renderRichParagraphs(block.content, `tex-${idx}`)}</div>
                          </section>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {selectedQuote ? (
                <div className="rounded-md border bg-[#FFFCDB] p-2">
                  <p className="text-xs font-semibold text-slate-700">Highlighted quote</p>
                  <p className="mt-1 text-xs text-slate-600">{selectedQuote}</p>
                  <textarea
                    value={quoteComment}
                    onChange={(e) => setQuoteComment(e.target.value)}
                    placeholder="Post inline review comment"
                    rows={3}
                    className="mt-2 w-full rounded border bg-white px-2 py-1 text-xs"
                  />
                  <button
                    type="button"
                    disabled={!sessionDid || busy || !quoteComment.trim()}
                    onClick={() => {
                      void submitInlineComment().catch((err: unknown) => {
                        setStatusMessage(err instanceof Error ? err.message : "Failed to post comment");
                      });
                    }}
                    className="mt-2 rounded bg-[#0085FF] px-2 py-1 text-xs text-white disabled:opacity-50"
                  >
                    Post Quote Comment
                  </button>
                </div>
              ) : null}

              {discussionRoot ? (
                <div className="rounded-md border bg-slate-50 p-2">
                  <p className="text-xs font-semibold text-slate-500">Root Post</p>
                  <p className="mt-1 text-sm text-slate-800">{discussionRoot.text}</p>
                </div>
              ) : (
                <p className="text-sm text-slate-500">No announcement thread yet.</p>
              )}

              <ul className="space-y-2">
                {discussionPosts.map((post) => (
                  <li
                    key={post.uri}
                    className={`rounded-md border p-2 ${post.quoted ? "border-amber-200 bg-amber-50/50" : ""}`}
                    style={{ marginLeft: `${Math.min(post.depth, 6) * 12}px` }}
                  >
                    <p className="text-xs text-slate-500">
                      @{post.handle ?? post.authorDid} · {timeAgo(post.createdAt)}
                    </p>
                    <div className="mt-1 flex items-center gap-1">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-600">
                        {post.source}
                      </span>
                      {post.quoted ? (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] uppercase text-amber-700">
                          quote
                        </span>
                      ) : null}
                    </div>
                    {post.quote ? (
                      <p className="mt-1 rounded bg-[#FFFCDB] px-2 py-1 text-xs text-slate-600">{post.quote}</p>
                    ) : null}
                    <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{post.text}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={!sessionDid}
                        onClick={() => {
                          void runEngagement("like", post).catch((err: unknown) => {
                            setStatusMessage(err instanceof Error ? err.message : "Like failed");
                          });
                        }}
                        className={`rounded border px-2 py-1 text-xs disabled:opacity-50 ${
                          post.liked ? "border-[#0085FF] text-[#0085FF]" : ""
                        }`}
                      >
                        Like
                      </button>
                      <button
                        type="button"
                        disabled={!sessionDid}
                        onClick={() => {
                          void runEngagement("repost", post).catch((err: unknown) => {
                            setStatusMessage(err instanceof Error ? err.message : "Repost failed");
                          });
                        }}
                        className={`rounded border px-2 py-1 text-xs disabled:opacity-50 ${
                          post.reposted ? "border-[#0085FF] text-[#0085FF]" : ""
                        }`}
                      >
                        Repost
                      </button>
                      <input
                        value={replyDrafts[post.uri] ?? ""}
                        onChange={(e) =>
                          setReplyDrafts((prev) => ({
                            ...prev,
                            [post.uri]: e.target.value,
                          }))
                        }
                        placeholder="Reply..."
                        disabled={!sessionDid}
                        className="min-w-28 flex-1 rounded border px-2 py-1 text-xs disabled:opacity-50"
                      />
                      <button
                        type="button"
                        disabled={!sessionDid}
                        onClick={() => {
                          const text = (replyDrafts[post.uri] ?? "").trim();
                          if (!text) return;
                          void runEngagement("reply", post, text).catch((err: unknown) => {
                            setStatusMessage(err instanceof Error ? err.message : "Reply failed");
                          });
                        }}
                        className="rounded border px-2 py-1 text-xs disabled:opacity-50"
                      >
                        Reply
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
