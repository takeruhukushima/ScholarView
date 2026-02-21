"use client";

import {
  Fragment,
  type DragEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import katex from "katex";

import { LoginForm } from "@/components/LoginForm";
import { LogoutButton } from "@/components/LogoutButton";
import type { ArticleBlock } from "@/lib/articles/blocks";
import { parseMarkdownToBlocks, parseTexToBlocks } from "@/lib/articles/blocks";
import {
  extractCitationKeysFromText,
  formatBibliographyIEEE,
  parseBibtexEntries,
  type BibliographyEntry,
} from "@/lib/articles/citations";
import type { SourceFormat } from "@/lib/db";
import type { ArticleSummary } from "@/lib/db/queries";
import { exportSource } from "@/lib/export/document";

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
  bibliography?: BibliographyEntry[];
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

interface CitationMenuState {
  blockId: string;
  start: number;
  end: number;
  query: string;
}

type TreeDropPosition = "before" | "after" | "inside";
type NewFileType = "markdown" | "tex" | "bib";

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

function headingHashToKind(value: string): BlockKind {
  if (value.length <= 1) return "h1";
  if (value.length === 2) return "h2";
  return "h3";
}

function normalizeEditedBlockInput(
  block: EditorBlock,
  rawText: string,
  sourceFormat: SourceFormat,
): Pick<EditorBlock, "kind" | "text"> {
  if (sourceFormat === "markdown") {
    const headingMatch = rawText.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      return {
        kind: headingHashToKind(headingMatch[1]),
        text: headingMatch[2],
      };
    }

    const inlineMathWrapped = rawText.match(/^\\\((.+)\\\)$/);
    if (inlineMathWrapped) {
      return { kind: block.kind, text: `$${inlineMathWrapped[1]}$` };
    }
    return { kind: block.kind, text: rawText };
  }

  const texHeading = rawText.match(/^\\(section|subsection|subsubsection)\{([^}]*)\}\s*$/);
  if (texHeading) {
    const command = texHeading[1];
    const kind =
      command === "section"
        ? "h1"
        : command === "subsection"
          ? "h2"
          : "h3";
    return {
      kind,
      text: texHeading[2],
    };
  }

  const mathWrapped = rawText.match(/^\\\[(.+)\\\]$/);
  if (mathWrapped) {
    return { kind: block.kind, text: `$$${mathWrapped[1]}$$` };
  }

  return { kind: block.kind, text: rawText };
}

function detectCitationTrigger(
  text: string,
  cursor: number,
): { start: number; end: number; query: string } | null {
  const before = text.slice(0, cursor);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;

  const prefix = at === 0 ? "" : before[at - 1];
  if (prefix && !/[\s([{"'`]/.test(prefix)) {
    return null;
  }

  const query = before.slice(at + 1);
  if (/[^A-Za-z0-9:_-]/.test(query)) {
    return null;
  }

  return { start: at, end: cursor, query };
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

function ensureFileExtension(name: string, type: NewFileType): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  if (/\.[A-Za-z0-9]+$/.test(trimmed)) return trimmed;
  if (type === "tex") return `${trimmed}.tex`;
  if (type === "bib") return `${trimmed}.bib`;
  return `${trimmed}.md`;
}

function findProjectRootFolderId(files: WorkspaceFile[], activeFileId: string | null): string | null {
  const byId = new Map<string, WorkspaceFile>();
  for (const file of files) {
    byId.set(file.id, file);
  }
  if (!activeFileId) return null;

  const activeFile = byId.get(activeFileId);
  if (!activeFile) return null;

  let folderId: string | null = activeFile.kind === "folder" ? activeFile.id : activeFile.parentId;
  if (!folderId) return null;

  while (folderId) {
    const nextParentId: string | null = byId.get(folderId)?.parentId ?? null;
    if (!nextParentId) return folderId;
    folderId = nextParentId;
  }

  return null;
}

function isDescendantOfFolder(
  byId: Map<string, WorkspaceFile>,
  parentId: string | null,
  ancestorFolderId: string,
): boolean {
  let cursor = parentId;
  while (cursor) {
    if (cursor === ancestorFolderId) return true;
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return false;
}

function collectProjectBibFiles(files: WorkspaceFile[], activeFileId: string | null): WorkspaceFile[] {
  const byId = new Map<string, WorkspaceFile>();
  for (const file of files) {
    byId.set(file.id, file);
  }
  const bibFiles = files
    .filter((file) => file.kind === "file" && file.name.toLowerCase().endsWith(".bib"))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  if (bibFiles.length === 0) return [];

  const projectRootFolderId = findProjectRootFolderId(files, activeFileId);
  if (!projectRootFolderId) {
    return bibFiles.filter((file) => file.parentId === null);
  }

  return bibFiles.filter((file) => isDescendantOfFolder(byId, file.parentId, projectRootFolderId));
}

function buildFilePathMap(files: WorkspaceFile[]): Map<string, string> {
  const byId = new Map<string, WorkspaceFile>();
  for (const file of files) {
    byId.set(file.id, file);
  }

  const memo = new Map<string, string>();
  const resolve = (id: string): string => {
    const cached = memo.get(id);
    if (cached) return cached;
    const file = byId.get(id);
    if (!file) return "";
    const parentPath = file.parentId ? resolve(file.parentId) : "";
    const path = `${parentPath}/${file.name}`.replace(/\/{2,}/g, "/");
    memo.set(id, path);
    return path;
  };

  for (const file of files) {
    resolve(file.id);
  }
  return memo;
}

function sanitizeFileStem(name: string): string {
  const cleaned = name
    .trim()
    .replace(/\.[^.]+$/, "")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || "image";
}

function inferImageExtension(name: string, mimeType: string): string {
  const fromName = name.toLowerCase().match(/\.(png|jpe?g|gif|webp|svg)$/);
  if (fromName) return fromName[1] === "jpeg" ? "jpg" : fromName[1];
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("jpeg")) return "jpg";
  if (mimeType.includes("gif")) return "gif";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("svg")) return "svg";
  return "png";
}

function toFigureLabel(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return `fig:${base || "image"}`;
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

function referenceAnchorId(prefix: string, key: string): string {
  return `${prefix}-${key.replace(/[^A-Za-z0-9_-]+/g, "-")}`;
}

function renderInlineText(
  text: string,
  keyPrefix: string,
  options?: {
    citationLookup?: Map<string, BibliographyEntry>;
    citationNumberByKey?: Map<string, number>;
    referenceAnchorPrefix?: string;
  },
): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokenRegex =
    /(`[^`]+`|\$\$[\s\S]+?\$\$|\$(?:\\.|[^$\n])+\$|\[@[A-Za-z0-9:_-]+\]|\*\*[^*]+\*\*|_[^_]+_|\[[^\]]+\]\((https?:\/\/[^)\s]+)\)|https?:\/\/[^\s]+)/g;
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
      const expr = token.slice(2, -2).trim();
      const mathHtml = renderMathHtml(expr, true);
      if (mathHtml) {
        nodes.push(
          <span
            key={key}
            className="my-1 block overflow-x-auto rounded border border-blue-100 bg-blue-50 px-2 py-1"
            dangerouslySetInnerHTML={{ __html: mathHtml }}
          />,
        );
      } else {
        nodes.push(
          <span
            key={key}
            className="select-text rounded bg-blue-50 px-1.5 py-0.5 font-mono text-[0.9em] text-blue-900"
          >
            {expr}
          </span>,
        );
      }
    } else if (token.startsWith("$") && token.endsWith("$")) {
      const expr = token.slice(1, -1).trim();
      const mathHtml = renderMathHtml(expr, false);
      if (mathHtml) {
        nodes.push(
          <span
            key={key}
            className="inline-block align-middle"
            dangerouslySetInnerHTML={{ __html: mathHtml }}
          />,
        );
      } else {
        nodes.push(
          <span
            key={key}
            className="select-text rounded bg-blue-50 px-1.5 py-0.5 font-mono text-[0.9em] text-blue-900"
          >
            {expr}
          </span>,
        );
      }
    } else if (token.startsWith("[@") && token.endsWith("]")) {
      const keyValue = token.slice(2, -1);
      const matched = options?.citationLookup?.get(keyValue);
      const number = options?.citationNumberByKey?.get(keyValue);
      if (number) {
        const anchorPrefix = options?.referenceAnchorPrefix ?? "ref";
        const href = `#${referenceAnchorId(anchorPrefix, keyValue)}`;
        nodes.push(
          <a
            key={key}
            href={href}
            className="inline-flex rounded px-1 py-0.5 font-mono text-[0.85em] text-[#0085FF] hover:underline"
            title={matched?.title ?? keyValue}
          >
            [{number}]
          </a>,
        );
      } else {
        nodes.push(
          <span
            key={key}
            className="inline-flex rounded bg-amber-100 px-1.5 py-0.5 text-[0.85em] text-amber-900"
            title={matched?.title ?? `Missing citation: ${keyValue}`}
          >
            [?]
          </span>,
        );
      }
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

function renderRichParagraphs(
  text: string,
  keyPrefix: string,
  options?: {
    citationLookup?: Map<string, BibliographyEntry>;
    citationNumberByKey?: Map<string, number>;
    referenceAnchorPrefix?: string;
    resolveImageSrc?: (input: string) => string;
  },
) {
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
        <div
          key={`${keyPrefix}-math-${i}`}
          className="overflow-x-auto rounded-md border border-blue-100 bg-blue-50 px-3 py-2"
        >
          {(() => {
            const mathHtml = renderMathHtml(mathLines.join("\n").trim(), true);
            if (mathHtml) {
              return <span dangerouslySetInnerHTML={{ __html: mathHtml }} />;
            }
            return (
              <span className="font-mono text-xs text-blue-900">{mathLines.join("\n")}</span>
            );
          })()}
        </div>,
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
              {renderInlineText(
                quoteLine,
                `${keyPrefix}-quote-inline-${quoteIndex}`,
                {
                  citationLookup: options?.citationLookup,
                  citationNumberByKey: options?.citationNumberByKey,
                  referenceAnchorPrefix: options?.referenceAnchorPrefix,
                },
              )}
            </p>
          ))}
        </blockquote>,
      );
      continue;
    }

    const imageMatch = line
      .trim()
      .match(/^!\[([^\]]*)\]\(([^)\s]+)\)(?:\{([^}]*)\})?$/);
    if (imageMatch) {
      const alt = imageMatch[1].trim();
      const rawSrc = imageMatch[2].trim();
      const attrs = imageMatch[3] ?? "";
      const labelMatch = attrs.match(/#([^\s}]+)/);
      const widthMatch = attrs.match(/width=([0-9.]+)/);
      const src = options?.resolveImageSrc ? options.resolveImageSrc(rawSrc) : rawSrc;
      const width = widthMatch ? Number(widthMatch[1]) : 0.8;
      nodes.push(
        <figure key={`${keyPrefix}-img-${i}`} className="space-y-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt || "figure"}
            style={{ maxWidth: `${Math.min(1, Math.max(0.1, width)) * 100}%` }}
            className="rounded border"
          />
          {(alt || labelMatch) ? (
            <figcaption className="text-xs text-slate-600">
              {alt}
              {labelMatch ? <span className="ml-1 font-mono text-slate-500">({labelMatch[1]})</span> : null}
            </figcaption>
          ) : null}
        </figure>,
      );
      i += 1;
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
              {renderInlineText(
                item,
                `${keyPrefix}-ul-inline-${itemIndex}`,
                {
                  citationLookup: options?.citationLookup,
                  citationNumberByKey: options?.citationNumberByKey,
                  referenceAnchorPrefix: options?.referenceAnchorPrefix,
                },
              )}
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
              {renderInlineText(
                item,
                `${keyPrefix}-ol-inline-${itemIndex}`,
                {
                  citationLookup: options?.citationLookup,
                  citationNumberByKey: options?.citationNumberByKey,
                  referenceAnchorPrefix: options?.referenceAnchorPrefix,
                },
              )}
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
            {renderInlineText(
              paragraphLine,
              `${keyPrefix}-p-inline-${paragraphIndex}`,
              {
                citationLookup: options?.citationLookup,
                citationNumberByKey: options?.citationNumberByKey,
                referenceAnchorPrefix: options?.referenceAnchorPrefix,
              },
            )}
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
  onRename,
  onDelete,
  onMove,
  draggable,
}: {
  files: WorkspaceFile[];
  activeFileId: string | null;
  onSelect: (file: WorkspaceFile) => void;
  onToggleFolder: (file: WorkspaceFile) => void;
  onRename?: (file: WorkspaceFile) => void;
  onDelete: (file: WorkspaceFile) => void;
  onMove?: (draggedId: string, target: WorkspaceFile, position: TreeDropPosition) => void;
  draggable?: boolean;
}) {
  const tree = useMemo(() => makeFileTree(files), [files]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const renderNode = (node: ReturnType<typeof makeFileTree>[number], depth: number) => {
    const isFolder = node.file.kind === "folder";
    const isActive = activeFileId === node.file.id;
    const expanded = node.file.expanded === 1;
    const getDropPosition = (event: DragEvent<HTMLDivElement>): TreeDropPosition => {
      const rect = event.currentTarget.getBoundingClientRect();
      const offsetY = event.clientY - rect.top;
      if (isFolder && offsetY >= rect.height * 0.25 && offsetY <= rect.height * 0.75) {
        return "inside";
      }
      return offsetY < rect.height / 2 ? "before" : "after";
    };

    return (
      <li key={node.file.id}>
        <div
          className={`group flex items-center gap-2 rounded-md px-2 py-1 text-sm ${
            isActive ? "bg-[#E7F2FF]" : "hover:bg-slate-100"
          } ${
            dragOverKey === `${node.file.id}:before`
              ? "border-t-2 border-[#0085FF]"
              : dragOverKey === `${node.file.id}:after`
                ? "border-b-2 border-[#0085FF]"
                : dragOverKey === `${node.file.id}:inside`
                  ? "bg-[#E7F2FF] ring-1 ring-inset ring-[#0085FF]"
                : ""
          }`}
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          draggable={Boolean(draggable)}
          onDragStart={(event) => {
            if (!draggable) return;
            setDraggingId(node.file.id);
            event.dataTransfer.setData("text/plain", node.file.id);
            event.dataTransfer.effectAllowed = "move";
          }}
          onDragEnd={() => {
            setDraggingId(null);
            setDragOverKey(null);
          }}
          onDragOver={(event) => {
            if (!onMove || !draggable) return;
            const dragId = event.dataTransfer.getData("text/plain") || draggingId;
            if (!dragId || dragId === node.file.id) return;
            event.preventDefault();
            const position = getDropPosition(event);
            setDragOverKey(`${node.file.id}:${position}`);
          }}
          onDrop={(event) => {
            if (!onMove || !draggable) return;
            const dragId = event.dataTransfer.getData("text/plain") || draggingId;
            if (!dragId || dragId === node.file.id) {
              setDragOverKey(null);
              setDraggingId(null);
              return;
            }
            event.preventDefault();
            const position = getDropPosition(event);
            onMove(dragId, node.file, position);
            setDragOverKey(null);
            setDraggingId(null);
          }}
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

          {onRename ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRename(node.file);
              }}
              className="rounded px-1 text-xs text-slate-400 opacity-0 transition hover:bg-slate-200 hover:text-slate-700 group-hover:opacity-100"
              title={`Rename ${node.file.kind}`}
              aria-label={`Rename ${node.file.kind}`}
            >
              ✎
            </button>
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
  const [articleBibliography, setArticleBibliography] = useState<BibliographyEntry[]>([]);
  const [citationMenu, setCitationMenu] = useState<CitationMenuState | null>(null);
  const [citationMenuIndex, setCitationMenuIndex] = useState(0);
  const [broadcastToBsky, setBroadcastToBsky] = useState(true);

  const [currentDid, setCurrentDid] = useState<string | null>(null);
  const [currentRkey, setCurrentRkey] = useState<string | null>(null);
  const [currentAuthorDid, setCurrentAuthorDid] = useState<string | null>(null);

  const [tab, setTab] = useState<RightTab>("discussion");
  const [discussionRoot, setDiscussionRoot] = useState<DiscussionRoot | null>(null);
  const [discussionPosts, setDiscussionPosts] = useState<DiscussionPost[]>([]);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [selectedQuote, setSelectedQuote] = useState("");
  const [quoteComment, setQuoteComment] = useState("");

  const [statusMessage, setStatusMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showLoginBox, setShowLoginBox] = useState(false);
  const [showNewFileForm, setShowNewFileForm] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [newFileType, setNewFileType] = useState<NewFileType>("markdown");
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
  const filePathMap = useMemo(() => buildFilePathMap(files), [files]);
  const projectBibFiles = useMemo(
    () => collectProjectBibFiles(files, activeFileId),
    [activeFileId, files],
  );
  const projectBibEntries = useMemo(() => {
    const merged = new Map<string, BibliographyEntry>();
    for (const file of projectBibFiles) {
      const entries = parseBibtexEntries(file.content ?? "");
      for (const entry of entries) {
        if (!merged.has(entry.key)) {
          merged.set(entry.key, entry);
        }
      }
    }
    return Array.from(merged.values());
  }, [projectBibFiles]);
  const activeBibByKey = useMemo(() => {
    const map = new Map<string, BibliographyEntry>();
    for (const entry of projectBibEntries) map.set(entry.key, entry);
    return map;
  }, [projectBibEntries]);
  const persistedBibByKey = useMemo(() => {
    const map = new Map<string, BibliographyEntry>();
    for (const entry of articleBibliography) map.set(entry.key, entry);
    return map;
  }, [articleBibliography]);

  const sourceText = useMemo(
    () => editorBlocksToSource(editorBlocks, sourceFormat),
    [editorBlocks, sourceFormat],
  );
  const citationKeys = useMemo(() => extractCitationKeysFromText(sourceText), [sourceText]);
  const resolvedBibliography = useMemo(() => {
    const resolved: BibliographyEntry[] = [];
    for (const key of citationKeys) {
      const fromBib = activeBibByKey.get(key);
      if (fromBib) {
        resolved.push(fromBib);
        continue;
      }
      const fromPersisted = persistedBibByKey.get(key);
      if (fromPersisted) resolved.push(fromPersisted);
    }
    return resolved;
  }, [activeBibByKey, citationKeys, persistedBibByKey]);
  const missingCitationKeys = useMemo(
    () =>
      citationKeys.filter(
        (key) => !activeBibByKey.has(key) && !persistedBibByKey.has(key),
      ),
    [activeBibByKey, citationKeys, persistedBibByKey],
  );
  const citationNumberByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < resolvedBibliography.length; i += 1) {
      map.set(resolvedBibliography[i].key, i + 1);
    }
    return map;
  }, [resolvedBibliography]);
  const renderCitationLookup = useMemo(() => {
    const map = new Map<string, BibliographyEntry>();
    for (const entry of resolvedBibliography) map.set(entry.key, entry);
    return map;
  }, [resolvedBibliography]);
  const resolveWorkspaceImageSrc = useCallback(
    (input: string) => {
      const match = input.match(/^workspace:\/\/(.+)$/);
      if (!match) return input;
      const file = files.find((item) => item.id === match[1]);
      if (!file || file.kind !== "file" || !file.content) return input;
      return file.content;
    },
    [files],
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
  const isBibWorkspaceFile = Boolean(
    activeFile?.kind === "file" && activeFile.name.toLowerCase().endsWith(".bib"),
  );
  const canPublishCurrentFile = canEditCurrentFile && !isBibWorkspaceFile;
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
        setArticleBibliography([]);
      }

      if (linked || (file.linkedArticleDid && file.linkedArticleRkey)) {
        const detailDid = linked?.did ?? file.linkedArticleDid;
        const detailRkey = linked?.rkey ?? file.linkedArticleRkey;
        if (detailDid && detailRkey) {
          try {
            const response = await fetch(
              `/api/articles/${encodeURIComponent(detailDid)}/${encodeURIComponent(detailRkey)}`,
              { cache: "no-store" },
            );
            const data = (await response.json()) as {
              success?: boolean;
              article?: Partial<ArticleDetailPayload>;
            };
            if (response.ok && data.success && data.article) {
              setArticleBibliography(
                Array.isArray(data.article.bibliography) ? data.article.bibliography : [],
              );
            } else {
              setArticleBibliography([]);
            }
          } catch {
            setArticleBibliography([]);
          }
        }
      }

      setSelectedQuote("");
      setQuoteComment("");
      setShowMoreMenu(false);
      setActiveBlockId(null);
      setBlockMenuForId(null);
      setCitationMenu(null);
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
      setArticleBibliography(
        Array.isArray(detail.bibliography) ? detail.bibliography : [],
      );
      setSelectedQuote("");
      setQuoteComment("");
      setShowMoreMenu(false);
      setActiveBlockId(null);
      setBlockMenuForId(null);
      setCitationMenu(null);
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

  const createWorkspaceItem = async (
    kind: "folder" | "file",
    options?: {
      name?: string;
      format?: SourceFormat;
      content?: string;
    },
  ) => {
    if (!sessionDid) {
      throw new Error("Login required");
    }

    const name =
      options?.name ?? window.prompt(kind === "folder" ? "Folder name" : "File name");
    if (!name) return;

    const parentId = activeFile?.kind === "folder" ? activeFile.id : activeFile?.parentId ?? null;

    const response = await fetch("/api/workspace/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parentId,
        name,
        kind,
        ...(kind === "file" && options?.format ? { format: options.format } : {}),
        ...(kind === "file" && options?.content !== undefined ? { content: options.content } : {}),
      }),
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

  const createWorkspaceFileFromForm = async () => {
    const name = ensureFileExtension(newFileName, newFileType);
    if (!name) {
      setStatusMessage("File name is required.");
      return;
    }
    const format: SourceFormat = newFileType === "tex" ? "tex" : "markdown";
    await createWorkspaceItem("file", {
      name,
      format,
      content: "",
    });
    setShowNewFileForm(false);
    setNewFileName("");
    setNewFileType("markdown");
  };

  const deleteWorkspaceItem = async (file: WorkspaceFile) => {
    const label = file.kind === "folder" ? "folder and all children" : "file";
    const confirmed = window.confirm(`Delete this ${label}?`);
    if (!confirmed) return;

    const response = await fetch(`/api/workspace/files/${encodeURIComponent(file.id)}`, {
      method: "DELETE",
    });
    const data = (await response.json()) as { success?: boolean; error?: string };
    if (!response.ok || !data.success) {
      throw new Error(data.error ?? "Failed to delete item");
    }

    const latestFiles = await loadFiles();
    if (activeFileId && !latestFiles.some((item) => item.id === activeFileId)) {
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
  };

  const renameWorkspaceItem = async (file: WorkspaceFile) => {
    if (!sessionDid) return;
    const requestedName = window.prompt(
      file.kind === "folder" ? "Rename folder" : "Rename file",
      file.name,
    );
    if (!requestedName) return;
    const trimmed = requestedName.trim();
    if (!trimmed) return;

    const isBibFile = file.kind === "file" && file.name.toLowerCase().endsWith(".bib");
    const nextName = isBibFile ? ensureFileExtension(trimmed, "bib") : trimmed;
    if (!nextName || nextName === file.name) return;

    const response = await fetch(`/api/workspace/files/${encodeURIComponent(file.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nextName }),
    });
    const data = (await response.json()) as { success?: boolean; error?: string };
    if (!response.ok || !data.success) {
      throw new Error(data.error ?? "Failed to rename item");
    }
    await loadFiles();
    setStatusMessage(`Renamed to ${nextName}`);
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
    if (activeFile.name.toLowerCase().endsWith(".bib")) {
      setStatusMessage("BibTeX files are citation data and cannot be published.");
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
            bibliography: resolvedBibliography.map((entry) => ({
              key: entry.key,
              rawBibtex: entry.rawBibtex,
            })),
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
      } else if (missingCitationKeys.length > 0) {
        setStatusMessage(`Published with ${missingCitationKeys.length} missing citation warning(s).`);
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
            bibliography: resolvedBibliography.map((entry) => ({
              key: entry.key,
              rawBibtex: entry.rawBibtex,
            })),
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

  const updateCitationMenu = useCallback(
    (blockId: string, text: string, cursor: number) => {
      const trigger = detectCitationTrigger(text, cursor);
      if (!trigger) {
        setCitationMenu((prev) => (prev?.blockId === blockId ? null : prev));
        return;
      }
      setCitationMenu({
        blockId,
        start: trigger.start,
        end: trigger.end,
        query: trigger.query,
      });
      setCitationMenuIndex(0);
    },
    [],
  );

  const filteredCitationEntries = useMemo(() => {
    if (!citationMenu) return [] as BibliographyEntry[];
    const query = citationMenu.query.trim().toLowerCase();
    const searchPool = projectBibEntries.length > 0 ? projectBibEntries : articleBibliography;
    if (!query) return searchPool.slice(0, 8);
    return searchPool
      .filter((entry) => {
        const haystack = `${entry.key} ${entry.title ?? ""} ${entry.author ?? ""}`.toLowerCase();
        return haystack.includes(query);
      })
      .slice(0, 8);
  }, [articleBibliography, citationMenu, projectBibEntries]);

  const applyCitationSuggestion = useCallback(
    (entry: BibliographyEntry) => {
      if (!citationMenu) return;
      const replacement = `[@${entry.key}]`;
      const targetId = citationMenu.blockId;

      setEditorBlocks((prev) =>
        prev.map((block) => {
          if (block.id !== targetId) return block;
          const before = block.text.slice(0, citationMenu.start);
          const after = block.text.slice(citationMenu.end);
          return {
            ...block,
            text: `${before}${replacement}${after}`,
          };
        }),
      );

      setCitationMenu(null);

      window.setTimeout(() => {
        const textarea = textareaRefs.current[targetId];
        if (!textarea) return;
        const nextPos = citationMenu.start + replacement.length;
        textarea.focus();
        textarea.setSelectionRange(nextPos, nextPos);
      }, 0);
    },
    [citationMenu],
  );

  const normalizeWorkspaceImageUrisForExport = useCallback(
    (input: string) =>
      input.replace(/!\[([^\]]*)\]\(workspace:\/\/([^)]+)\)(\{[^}]*\})?/g, (_all, alt, id, attrs) => {
        const file = files.find((item) => item.id === id);
        if (!file || file.kind !== "file") return _all;
        const path = filePathMap.get(file.id) ?? `/assets/${file.name}`;
        return `![${alt}](${path})${attrs ?? ""}`;
      }),
    [filePathMap, files],
  );

  const downloadTextAsFile = (filename: string, text: string, mimeType = "text/plain;charset=utf-8") => {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const handleExport = (target: "md" | "tex") => {
    const normalizedSource = normalizeWorkspaceImageUrisForExport(sourceText);
    const result = exportSource(normalizedSource, sourceFormat, target, resolvedBibliography);
    const base = sanitizeFileStem(title || activeFile?.name || "untitled");
    downloadTextAsFile(`${base}.${target}`, result.content);
    if (missingCitationKeys.length > 0) {
      setStatusMessage(`Exported with ${missingCitationKeys.length} unresolved citation warning(s).`);
    } else {
      setStatusMessage(`Exported ${base}.${target}`);
    }
  };

  const handleSourceFormatChange = useCallback(
    (nextFormat: SourceFormat) => {
      if (nextFormat === sourceFormat) return;
      const currentSource = editorBlocksToSource(editorBlocks, sourceFormat);
      const nextBlocks = sourceToEditorBlocks(currentSource, nextFormat);
      setSourceFormat(nextFormat);
      setEditorBlocks(nextBlocks);
      setCitationMenu(null);
      setBlockMenuForId(null);
      setActiveBlockId(null);
    },
    [editorBlocks, sourceFormat],
  );

  const readFileAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          resolve(reader.result);
          return;
        }
        reject(new Error("Failed to read image file"));
      };
      reader.onerror = () => reject(new Error("Failed to read image file"));
      reader.readAsDataURL(file);
    });

  const ensureAssetsFolder = async () => {
    const existing = files.find(
      (file) => file.kind === "folder" && file.parentId === null && file.name === "assets",
    );
    if (existing) return existing.id;

    const response = await fetch("/api/workspace/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "assets", kind: "folder", parentId: null }),
    });
    const data = (await response.json()) as { success?: boolean; file?: WorkspaceFile; error?: string };
    if (!response.ok || !data.success || !data.file) {
      throw new Error(data.error ?? "Failed to create assets folder");
    }
    await loadFiles();
    return data.file.id;
  };

  const handleImageDrop = async (event: DragEvent<HTMLElement>) => {
    if (!canEditCurrentFile || !sessionDid) return;
    const dropped = Array.from(event.dataTransfer.files ?? []).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (dropped.length === 0) return;

    event.preventDefault();
    event.stopPropagation();

    try {
      const assetsFolderId = await ensureAssetsFolder();
      const activeId = activeBlockId ?? editorBlocks[editorBlocks.length - 1]?.id;
      for (const image of dropped) {
        const dataUrl = await readFileAsDataUrl(image);
        const ext = inferImageExtension(image.name, image.type);
        const stem = sanitizeFileStem(image.name);
        const fileName = `${stem}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}.${ext}`;
        const response = await fetch("/api/workspace/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            parentId: assetsFolderId,
            name: fileName,
            kind: "file",
            format: "markdown",
            content: dataUrl,
          }),
        });
        const data = (await response.json()) as { success?: boolean; file?: WorkspaceFile; error?: string };
        if (!response.ok || !data.success || !data.file) {
          throw new Error(data.error ?? "Failed to store image");
        }

        const figureLabel = toFigureLabel(stem);
        const token = `![${stem}](workspace://${data.file.id}){#${figureLabel} width=0.8}`;
        setEditorBlocks((prev) => {
          if (!activeId) {
            return [...prev, { id: newId(), kind: "paragraph", text: token }];
          }
          const idx = prev.findIndex((block) => block.id === activeId);
          if (idx === -1) return [...prev, { id: newId(), kind: "paragraph", text: token }];
          const next = [...prev];
          next.splice(idx + 1, 0, { id: newId(), kind: "paragraph", text: token });
          return next;
        });
      }
      await loadFiles();
      setStatusMessage("Inserted image figure block(s).");
    } catch (err: unknown) {
      setStatusMessage(err instanceof Error ? err.message : "Failed to insert image");
    }
  };

  const handleMoveWorkspaceItem = useCallback(
    async (draggedId: string, target: WorkspaceFile, position: TreeDropPosition) => {
      if (!sessionDid) return;
      if (draggedId === target.id) return;

      const byId = new Map(files.map((file) => [file.id, file]));
      const dragged = byId.get(draggedId);
      const targetFile = byId.get(target.id);
      if (!dragged || !targetFile) return;

      const nextParentId =
        position === "inside" && targetFile.kind === "folder" ? targetFile.id : targetFile.parentId;
      let cursor = nextParentId;
      while (cursor) {
        if (cursor === dragged.id) {
          setStatusMessage("Cannot move a folder into its descendant.");
          return;
        }
        cursor = byId.get(cursor)?.parentId ?? null;
      }

      const siblingSorter = (a: WorkspaceFile, b: WorkspaceFile) =>
        a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

      const nextSiblings = files
        .filter((file) => file.parentId === nextParentId && file.id !== dragged.id)
        .sort(siblingSorter);
      if (position === "inside" && targetFile.kind === "folder") {
        nextSiblings.push({ ...dragged, parentId: nextParentId });
      } else {
        const targetIndex = nextSiblings.findIndex((file) => file.id === targetFile.id);
        if (targetIndex === -1) return;
        const insertIndex = position === "after" ? targetIndex + 1 : targetIndex;
        nextSiblings.splice(insertIndex, 0, { ...dragged, parentId: nextParentId });
      }

      const oldParentSiblings =
        dragged.parentId === nextParentId
          ? []
          : files
              .filter((file) => file.parentId === dragged.parentId && file.id !== dragged.id)
              .sort(siblingSorter);

      const updates: Array<{ id: string; parentId?: string | null; sortOrder: number }> = [];
      for (let i = 0; i < nextSiblings.length; i += 1) {
        const file = nextSiblings[i];
        updates.push({
          id: file.id,
          sortOrder: i,
          ...(file.id === dragged.id ? { parentId: nextParentId } : {}),
        });
      }
      for (let i = 0; i < oldParentSiblings.length; i += 1) {
        updates.push({
          id: oldParentSiblings[i].id,
          sortOrder: i,
        });
      }

      const deduped = new Map<string, { id: string; parentId?: string | null; sortOrder: number }>();
      for (const update of updates) {
        deduped.set(update.id, update);
      }

      const responses = await Promise.all(
        Array.from(deduped.values()).map(async (update) => {
          const response = await fetch(`/api/workspace/files/${encodeURIComponent(update.id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...(update.parentId !== undefined ? { parentId: update.parentId } : {}),
              sortOrder: update.sortOrder,
            }),
          });
          const data = (await response.json()) as { success?: boolean; error?: string };
          if (!response.ok || !data.success) {
            throw new Error(data.error ?? "Failed to reorder file tree");
          }
        }),
      );
      void responses;

      await loadFiles();
      setStatusMessage("Updated file order.");
    },
    [files, loadFiles, sessionDid],
  );

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
    setActiveBlockId(block.id);
    setBlockMenuForId(null);
    setCitationMenu(null);

    window.setTimeout(() => {
      const textarea = textareaRefs.current[block.id];
      if (!textarea) {
        window.setTimeout(() => {
          const retry = textareaRefs.current[block.id];
          if (!retry) return;
          retry.focus();
          retry.setSelectionRange(0, 0);
          resizeTextarea(retry);
        }, 0);
        return;
      }
      textarea.focus();
      textarea.setSelectionRange(0, 0);
      resizeTextarea(textarea);
    }, 0);
  };

  const removeBlock = (index: number) => {
    setEditorBlocks((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((_, idx) => idx !== index);
      const fallback = next[Math.max(0, index - 1)];
      window.setTimeout(() => {
        if (fallback) {
          setActiveBlockId(fallback.id);
          window.setTimeout(() => {
            textareaRefs.current[fallback.id]?.focus();
          }, 0);
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

  const shouldShowStatus = Boolean(statusMessage);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_right,_#E9F4FF_0%,_#F8FAFC_45%)] p-4 md:p-6">
      <OnboardingTour />

      {shouldShowStatus ? (
        <p className="mb-3 rounded-md border bg-white px-3 py-2 text-sm text-slate-600">{statusMessage}</p>
      ) : null}

      <div className="grid min-h-[calc(100vh-4rem)] grid-cols-1 gap-4 lg:grid-cols-[280px_1fr_360px]">
        <aside data-tour-id="sidebar" className="rounded-xl border bg-white p-3 shadow-sm">
          <section className="mb-4 space-y-3 rounded-lg border bg-slate-50 p-3">
            <div>
              <h1 className="text-lg font-semibold text-slate-900">ScholarView Workspace</h1>
            </div>
            <form method="GET" action="/articles" className="flex gap-2">
              <input
                type="search"
                name="q"
                placeholder="Search published articles..."
                className="w-full rounded border px-2 py-1 text-xs outline-none focus:border-[#0085FF]"
              />
              <button type="submit" className="rounded border px-2 py-1 text-xs hover:bg-white">
                Search
              </button>
            </form>
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  window.localStorage.removeItem(TUTORIAL_STORAGE_KEY);
                  window.location.reload();
                }}
                className="rounded border px-2 py-1 text-xs hover:bg-white"
                title="Show tutorial"
              >
                ?
              </button>
              {sessionDid ? (
                <div className="flex items-center gap-2">
                  <span className="max-w-[8rem] truncate text-xs text-slate-700">@{accountHandle ?? sessionDid}</span>
                  <LogoutButton />
                </div>
              ) : (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowLoginBox((prev) => !prev)}
                    className="rounded border px-2 py-1 text-xs hover:bg-white"
                  >
                    Sign in
                  </button>
                  {showLoginBox ? (
                    <div className="absolute right-0 top-9 z-30 w-64 rounded-md border bg-white p-2 shadow-lg">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-xs font-semibold text-slate-700">Login</p>
                        <button
                          type="button"
                          onClick={() => setShowLoginBox(false)}
                          className="rounded px-1 text-xs text-slate-500 hover:bg-slate-100"
                          aria-label="Close login panel"
                        >
                          ×
                        </button>
                      </div>
                      <LoginForm />
                    </div>
                  ) : null}
                </div>
              )}
            </div>
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
                      setShowNewFileForm((prev) => !prev);
                    }}
                    className="rounded border px-2 py-0.5 text-xs"
                  >
                    +File
                  </button>
                </div>
              ) : null}
            </div>
            {sessionDid && showNewFileForm ? (
              <form
                className="mb-2 space-y-2 rounded border bg-slate-50 p-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void createWorkspaceFileFromForm().catch((err: unknown) => {
                    setStatusMessage(err instanceof Error ? err.message : "Failed to create file");
                  });
                }}
              >
                <input
                  value={newFileName}
                  onChange={(event) => setNewFileName(event.target.value)}
                  placeholder="File name"
                  className="w-full rounded border px-2 py-1 text-xs"
                  autoFocus
                />
                <div className="flex items-center gap-2">
                  <select
                    value={newFileType}
                    onChange={(event) => setNewFileType(event.target.value as NewFileType)}
                    className="min-w-0 flex-1 rounded border px-2 py-1 text-xs"
                  >
                    <option value="markdown">Markdown (.md)</option>
                    <option value="tex">TeX (.tex)</option>
                    <option value="bib">BibTeX (.bib)</option>
                  </select>
                  <button type="submit" className="rounded border px-2 py-1 text-xs">
                    Create
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowNewFileForm(false);
                      setNewFileName("");
                      setNewFileType("markdown");
                    }}
                    className="rounded border px-2 py-1 text-xs text-slate-600"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : null}

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
                onRename={(file) => {
                  void renameWorkspaceItem(file).catch((err: unknown) => {
                    setStatusMessage(err instanceof Error ? err.message : "Failed to rename item");
                  });
                }}
                onDelete={(file) => {
                  void deleteWorkspaceItem(file).catch((err: unknown) => {
                    setStatusMessage(err instanceof Error ? err.message : "Failed to delete item");
                  });
                }}
                onMove={(draggedId, target, position) => {
                  void handleMoveWorkspaceItem(draggedId, target, position).catch((err: unknown) => {
                    setStatusMessage(err instanceof Error ? err.message : "Failed to reorder file tree");
                  });
                }}
                draggable={Boolean(sessionDid)}
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

        <section
          data-tour-id="editor"
          className="rounded-xl border bg-white p-4 shadow-sm"
          onDragOver={(event) => {
            if (!canEditCurrentFile) return;
            if (Array.from(event.dataTransfer.items ?? []).some((item) => item.type.startsWith("image/"))) {
              event.preventDefault();
            }
          }}
          onDrop={(event) => {
            void handleImageDrop(event);
          }}
        >
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

                  {canPublishCurrentFile ? (
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
                              onChange={(e) => handleSourceFormatChange(e.target.value as SourceFormat)}
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

                          <div className="mb-2 space-y-1">
                            <button
                              type="button"
                              onClick={() => handleExport("md")}
                              className="w-full rounded border px-2 py-1 text-left text-xs hover:bg-slate-50"
                            >
                              Export .md
                            </button>
                            <button
                              type="button"
                              onClick={() => handleExport("tex")}
                              className="w-full rounded border px-2 py-1 text-left text-xs hover:bg-slate-50"
                            >
                              Export .tex
                            </button>
                          </div>

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

                    <div className="w-full">
                      {canEditCurrentFile && activeBlockId === block.id ? (
                        <>
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
                            onBlur={() => {
                              window.setTimeout(() => {
                                if (citationMenu?.blockId === block.id) return;
                                setActiveBlockId((prev) => (prev === block.id ? null : prev));
                              }, 0);
                            }}
                            onChange={(e) => {
                              const nextValue = e.target.value;
                              const normalized = normalizeEditedBlockInput(
                                block,
                                nextValue,
                                sourceFormat,
                              );
                              updateBlock(block.id, normalized);
                              resizeTextarea(e.target);
                              updateCitationMenu(block.id, normalized.text, e.target.selectionStart);
                            }}
                            onSelect={(e) => {
                              const target = e.currentTarget;
                              const quote = target.value.slice(target.selectionStart, target.selectionEnd).trim();
                              setSelectedQuote(quote.slice(0, 280));
                            }}
                            onKeyDown={(e) => {
                              if (!canEditCurrentFile) return;

                              const menuOpenForBlock =
                                citationMenu?.blockId === block.id &&
                                filteredCitationEntries.length > 0;
                              if (menuOpenForBlock && e.key === "ArrowDown") {
                                e.preventDefault();
                                setCitationMenuIndex(
                                  (prev) => (prev + 1) % filteredCitationEntries.length,
                                );
                                return;
                              }
                              if (menuOpenForBlock && e.key === "ArrowUp") {
                                e.preventDefault();
                                setCitationMenuIndex(
                                  (prev) =>
                                    (prev - 1 + filteredCitationEntries.length) %
                                    filteredCitationEntries.length,
                                );
                                return;
                              }
                              if (menuOpenForBlock && e.key === "Escape") {
                                e.preventDefault();
                                setCitationMenu(null);
                                return;
                              }
                              if (menuOpenForBlock && e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                const picked = filteredCitationEntries[citationMenuIndex];
                                if (picked) {
                                  applyCitationSuggestion(picked);
                                }
                                return;
                              }

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
                            placeholder={block.kind === "paragraph" ? "" : "Heading"}
                            className={`w-full resize-none border-none bg-transparent p-0 outline-none ${blockTextClass(
                              block.kind,
                            )} select-text`}
                          />
                          {citationMenu?.blockId === block.id ? (
                            <div className="mt-1 rounded-md border bg-white p-1 shadow-sm">
                              {filteredCitationEntries.length === 0 ? (
                                <p className="px-2 py-1 text-xs text-slate-500">No citation match.</p>
                              ) : (
                                <ul className="max-h-48 overflow-auto">
                                  {filteredCitationEntries.map((entry, idx) => (
                                    <li key={entry.key}>
                                      <button
                                        type="button"
                                        onMouseDown={(event) => event.preventDefault()}
                                        onClick={() => applyCitationSuggestion(entry)}
                                        className={`w-full rounded px-2 py-1 text-left text-xs ${
                                          idx === citationMenuIndex ? "bg-[#E7F2FF]" : "hover:bg-slate-50"
                                        }`}
                                      >
                                        <p className="font-mono text-[11px] text-slate-700">[@{entry.key}]</p>
                                        <p className="truncate text-slate-500">{entry.title ?? entry.author ?? "-"}</p>
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <div
                          role={canEditCurrentFile ? "button" : undefined}
                          tabIndex={canEditCurrentFile ? 0 : undefined}
                          onClick={(event) => {
                            if (!canEditCurrentFile) return;
                            const target = event.target;
                            if (target instanceof HTMLElement && target.closest("a")) {
                              return;
                            }
                            setActiveBlockId(block.id);
                            setBlockMenuForId(null);
                            setCitationMenu(null);
                            window.setTimeout(() => {
                              const textarea = textareaRefs.current[block.id];
                              if (!textarea) return;
                              textarea.focus();
                              const position = textarea.value.length;
                              textarea.setSelectionRange(position, position);
                            }, 0);
                          }}
                          onKeyDown={(event) => {
                            if (!canEditCurrentFile) return;
                            if (event.key !== "Enter" && event.key !== " ") return;
                            event.preventDefault();
                            setActiveBlockId(block.id);
                            window.setTimeout(() => {
                              textareaRefs.current[block.id]?.focus();
                            }, 0);
                          }}
                          className={`min-h-[1.5rem] w-full rounded px-0.5 py-0.5 ${
                            canEditCurrentFile ? "cursor-text" : ""
                          }`}
                        >
                          {block.text.trim().length > 0 ? (
                            block.kind === "paragraph" ? (
                              renderRichParagraphs(block.text, `editor-block-preview-${block.id}`, {
                                citationLookup: renderCitationLookup,
                                citationNumberByKey,
                                referenceAnchorPrefix: "editor-ref",
                                resolveImageSrc: resolveWorkspaceImageSrc,
                              })
                            ) : (
                              <p className={`${blockTextClass(block.kind)} whitespace-pre-wrap`}>
                                {renderInlineText(
                                  block.text,
                                  `editor-heading-preview-${block.id}`,
                                  {
                                    citationLookup: renderCitationLookup,
                                    citationNumberByKey,
                                    referenceAnchorPrefix: "editor-ref",
                                  },
                                )}
                              </p>
                            )
                          ) : (
                            block.kind === "paragraph" ? (
                              <p className="h-6" />
                            ) : (
                              <p className="text-sm text-slate-400">Heading</p>
                            )
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {resolvedBibliography.length > 0 ? (
                <section className="mt-4 rounded-md border p-3">
                  <p className="text-xs text-slate-500">References</p>
                  <ul className="mt-2 space-y-1 text-xs text-slate-700">
                    {formatBibliographyIEEE(resolvedBibliography).map((line, index) => (
                      <li
                        key={`${line}-${index}`}
                        id={referenceAnchorId("editor-ref", resolvedBibliography[index].key)}
                        className="scroll-mt-24"
                      >
                        {line}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

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
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Discussion</p>

          {tab === "preview" ? (
            <div className="space-y-3" onMouseUp={captureWindowSelection}>
              {sourceFormat === "markdown" ? (
                <>
                  <p className="text-xs text-slate-500">Markdown Preview</p>
                  <div className="rounded-md border p-3 select-text">
                    {sourceText.trim() ? (
                      renderRichParagraphs(sourceText, "md-preview", {
                        citationLookup: renderCitationLookup,
                        citationNumberByKey,
                        referenceAnchorPrefix: "preview-ref",
                        resolveImageSrc: resolveWorkspaceImageSrc,
                      })
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
                            <div className="mt-2">
                              {renderRichParagraphs(block.content, `tex-${idx}`, {
                                citationLookup: renderCitationLookup,
                                citationNumberByKey,
                                referenceAnchorPrefix: "preview-ref",
                                resolveImageSrc: resolveWorkspaceImageSrc,
                              })}
                            </div>
                          </section>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
              {resolvedBibliography.length > 0 ? (
                <section className="rounded-md border p-3">
                  <p className="text-xs text-slate-500">References (IEEE)</p>
                  <ul className="mt-2 space-y-1 text-xs text-slate-700">
                    {formatBibliographyIEEE(resolvedBibliography).map((line, index) => (
                      <li
                        key={`${line}-${index}`}
                        id={referenceAnchorId("preview-ref", resolvedBibliography[index].key)}
                        className="scroll-mt-24"
                      >
                        {line}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {missingCitationKeys.length > 0 ? (
                <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900">
                  Missing bibliography keys: {missingCitationKeys.join(", ")}
                </p>
              ) : null}
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
                  <p className="mt-1 break-all text-sm text-slate-800">{discussionRoot.text}</p>
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
                      <p className="mt-1 break-all rounded bg-[#FFFCDB] px-2 py-1 text-xs text-slate-600">
                        {post.quote}
                      </p>
                    ) : null}
                    <p className="mt-2 whitespace-pre-wrap break-all text-sm text-slate-800">{post.text}</p>
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
