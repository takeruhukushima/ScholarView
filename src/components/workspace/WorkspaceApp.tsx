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
  formatBibtexSource,
  formatBibliographyIEEE,
  parseBibtexEntries,
  splitBibtexSourceBlocks,
  type BibliographyEntry,
} from "@/lib/articles/citations";
import { exportSource } from "@/lib/export/document";
import type { ArticleSummary, SourceFormat } from "@/lib/types";

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
type ImageDropPosition = "before" | "after";
type ImageAlign = "left" | "center" | "right";
type BlockMoveDropTarget = { blockId: string; position: ImageDropPosition };

interface ParsedMarkdownImageLine {
  alt: string;
  rawSrc: string;
  attrs: string;
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

function composeFileNameFromTitle(title: string, currentName: string): string {
  const trimmed = title.trim();
  if (!trimmed) return "";

  const extMatch = currentName.match(/(\.[A-Za-z0-9]+)$/);
  const ext = extMatch?.[1] ?? "";
  if (!ext) return trimmed;

  const base = trimmed.toLowerCase().endsWith(ext.toLowerCase())
    ? trimmed.slice(0, trimmed.length - ext.length).trim()
    : trimmed;
  if (!base) return "";
  return `${base}${ext}`;
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

function sourceToBibEditorBlocks(source: string): EditorBlock[] {
  const chunks = splitBibtexSourceBlocks(source);
  if (chunks.length === 0) {
    return [{ id: newId(), kind: "paragraph", text: "" }];
  }
  return chunks.map((text) => ({ id: newId(), kind: "paragraph", text }));
}

function bibEditorBlocksToSource(blocks: EditorBlock[]): string {
  const normalized = blocks
    .map((block) => block.text.replace(/\r\n?/g, "\n").trim())
    .filter(Boolean);
  return normalized.join("\n\n").trim();
}

function renderBibtexHighlighted(text: string, keyPrefix: string): ReactNode[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  return lines.map((line, lineIndex) => {
    const entryMatch = line.match(/^(\s*)@([A-Za-z]+)(\s*[{(]\s*)([^,\s]+)(.*)$/);
    if (entryMatch) {
      return (
        <Fragment key={`${keyPrefix}-line-${lineIndex}`}>
          {entryMatch[1]}
          <span className="text-slate-500">@</span>
          <span className="font-medium text-indigo-700">{entryMatch[2]}</span>
          {entryMatch[3]}
          <span className="font-medium text-emerald-700">{entryMatch[4]}</span>
          {entryMatch[5]}
          {lineIndex < lines.length - 1 ? <br /> : null}
        </Fragment>
      );
    }

    const fieldMatch = line.match(/^(\s*)([A-Za-z][A-Za-z0-9:_-]*)(\s*=\s*)(.*)$/);
    if (fieldMatch) {
      return (
        <Fragment key={`${keyPrefix}-line-${lineIndex}`}>
          {fieldMatch[1]}
          <span className="font-medium text-blue-700">{fieldMatch[2]}</span>
          {fieldMatch[3]}
          {fieldMatch[4]}
          {lineIndex < lines.length - 1 ? <br /> : null}
        </Fragment>
      );
    }

    return (
      <Fragment key={`${keyPrefix}-line-${lineIndex}`}>
        {line}
        {lineIndex < lines.length - 1 ? <br /> : null}
      </Fragment>
    );
  });
}

function isClosedBibtexEntryBlock(text: string): boolean {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return false;
  if (!/[})]\s*$/.test(normalized)) return false;
  const parsed = parseBibtexEntries(normalized);
  return parsed.length === 1 && parsed[0].rawBibtex === normalized;
}

function createBibtexTemplate(source: string): {
  text: string;
  selectionStart: number;
  selectionEnd: number;
} {
  const used = new Set(parseBibtexEntries(source).map((entry) => entry.key));
  let key = "citation_key";
  let suffix = 2;
  while (used.has(key)) {
    key = `citation_key_${suffix}`;
    suffix += 1;
  }

  const text = `@article{${key},\n  author = {},\n  title  = {},\n  year   = {},\n}`;
  const authorFieldStart = text.indexOf("author = {");
  const selectionStart =
    authorFieldStart >= 0 ? authorFieldStart + "author = {".length : "@article{".length + key.length;
  const selectionEnd = selectionStart;
  return { text, selectionStart, selectionEnd };
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

function createUniqueImageFileName(
  stem: string,
  ext: string,
  takenLowerNames: Set<string>,
): string {
  const safeStem = sanitizeFileStem(stem) || "image";
  const safeExt = ext.replace(/^\.+/, "").toLowerCase() || "png";
  const base = `${safeStem}.${safeExt}`;
  const baseLower = base.toLowerCase();
  if (!takenLowerNames.has(baseLower)) {
    takenLowerNames.add(baseLower);
    return base;
  }

  let suffix = 2;
  for (;;) {
    const candidate = `${safeStem}-${suffix}.${safeExt}`;
    const key = candidate.toLowerCase();
    if (!takenLowerNames.has(key)) {
      takenLowerNames.add(key);
      return candidate;
    }
    suffix += 1;
  }
}

function isImageFileName(name: string): boolean {
  return /\.(avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(name.trim());
}

function isInlineImageDataUrl(input: string | null | undefined): boolean {
  if (!input) return false;
  const trimmed = input.trim();
  return /^(?:data|ata):image\/[a-z0-9.+-]+(?:;[a-z0-9.+-]+=[^;,]+|;base64)*,/i.test(trimmed);
}

function isWorkspaceImageFile(file: Pick<WorkspaceFile, "kind" | "name" | "content">): boolean {
  return file.kind === "file" && (isImageFileName(file.name) || isInlineImageDataUrl(file.content));
}

function normalizeImageSrcCandidate(input: string): string {
  const trimmed = input.trim();
  if (/^ata:image\//i.test(trimmed)) {
    return `d${trimmed}`;
  }
  return trimmed;
}

function deriveImagePreviewSource(
  input: string | null | undefined,
  resolveWorkspaceImageSrc: (input: string) => string,
): string | null {
  if (!input) return null;
  const candidate = normalizeImageSrcCandidate(input);
  if (!candidate) return null;
  if (isInlineImageDataUrl(candidate)) return normalizeImageSrcCandidate(candidate);
  if (/^(https?:\/\/|blob:|\/)/i.test(candidate)) return candidate;

  const markdownImage = candidate.match(/^!\[[^\]]*\]\(([^)\s]+)\)/);
  if (markdownImage) {
    const resolved = normalizeImageSrcCandidate(resolveWorkspaceImageSrc(markdownImage[1]));
    if (isInlineImageDataUrl(resolved) || /^(https?:\/\/|blob:|\/)/i.test(resolved)) {
      return resolved;
    }
  }

  const resolved = normalizeImageSrcCandidate(resolveWorkspaceImageSrc(candidate));
  if (isInlineImageDataUrl(resolved) || /^(https?:\/\/|blob:|\/)/i.test(resolved)) {
    return resolved;
  }
  return null;
}

function normalizeWorkspacePath(input: string): string {
  const cleaned = input.trim().replace(/\\/g, "/");
  if (!cleaned) return "/";
  const noFragment = cleaned.split("#")[0] ?? "";
  const noQuery = noFragment.split("?")[0] ?? "";
  const parts = noQuery.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (stack.length > 0) {
        stack.pop();
      }
      continue;
    }
    stack.push(part);
  }
  return `/${stack.join("/")}`.replace(/\/{2,}/g, "/");
}

function dirnameWorkspacePath(path: string): string {
  const normalized = normalizeWorkspacePath(path);
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 1) return "/";
  return `/${parts.slice(0, -1).join("/")}`;
}

function resolveWorkspacePathFromDocument(input: string, documentPath: string | null): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("workspace://")) return null;
  if (trimmed.startsWith("data:")) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return null;
  if (trimmed.startsWith("#")) return null;

  if (trimmed.startsWith("/")) {
    return normalizeWorkspacePath(trimmed);
  }

  const base = dirnameWorkspacePath(documentPath ?? "/");
  return normalizeWorkspacePath(`${base}/${trimmed}`);
}

function rewriteImagePathReferencesInMarkdown(
  source: string,
  options: {
    movedFileId: string;
    oldPath: string;
    newPath: string;
    documentPath: string | null;
  },
): string {
  return source.replace(/!\[([^\]]*)\]\(([^)]+)\)(\{[^}]*\})?/g, (_all, alt, rawSrc, attrs) => {
    const src = String(rawSrc).trim();
    const byId = src.match(/^workspace:\/\/(.+)$/)?.[1];
    const resolved = resolveWorkspacePathFromDocument(src, options.documentPath);
    const shouldRewrite = byId === options.movedFileId || resolved === options.oldPath;
    if (!shouldRewrite) return _all;
    return `![${alt}](${options.newPath})${attrs ?? ""}`;
  });
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

function parseMarkdownImageLine(text: string): ParsedMarkdownImageLine | null {
  const match = text.trim().match(/^!\[([^\]]*)\]\(([^)\s]+)\)(?:\{([^}]*)\})?$/);
  if (!match) return null;
  return {
    alt: match[1].trim(),
    rawSrc: match[2].trim(),
    attrs: (match[3] ?? "").trim(),
  };
}

function imageAlignFromAttrs(attrs: string): ImageAlign {
  const match = attrs.match(/\balign=(left|center|right)\b/i);
  if (!match) return "center";
  const value = match[1].toLowerCase();
  return value === "left" || value === "right" ? value : "center";
}

function setImageAlignOnMarkdownLine(text: string, align: ImageAlign): string {
  const parsed = parseMarkdownImageLine(text);
  if (!parsed) return text;
  const tokens = parsed.attrs.length > 0 ? parsed.attrs.split(/\s+/).filter(Boolean) : [];
  const kept = tokens.filter((token) => !/^align=(left|center|right)$/i.test(token));
  kept.push(`align=${align}`);
  const attrs = kept.length > 0 ? `{${kept.join(" ")}}` : "";
  return `![${parsed.alt}](${parsed.rawSrc})${attrs}`;
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

    const imageLine = parseMarkdownImageLine(line);
    if (imageLine) {
      const alt = imageLine.alt;
      const rawSrc = imageLine.rawSrc;
      const attrs = imageLine.attrs;
      const labelMatch = attrs.match(/#([^\s}]+)/);
      const widthMatch = attrs.match(/width=([0-9.]+)/);
      const align = imageAlignFromAttrs(attrs);
      const src = options?.resolveImageSrc ? options.resolveImageSrc(rawSrc) : rawSrc;
      const width = widthMatch ? Number(widthMatch[1]) : 0.8;
      nodes.push(
        <figure
          key={`${keyPrefix}-img-${i}`}
          className={`space-y-1 ${
            align === "left" ? "text-left" : align === "right" ? "text-right" : "text-center"
          }`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt || "figure"}
            style={{
              maxWidth: `${Math.min(1, Math.max(0.1, width)) * 100}%`,
              marginLeft: align === "right" || align === "center" ? "auto" : undefined,
              marginRight: align === "left" || align === "center" ? "auto" : undefined,
            }}
            className="block rounded border"
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
  const [activeImagePreviewSrc, setActiveImagePreviewSrc] = useState<string | null>(null);
  const [imageDropTarget, setImageDropTarget] = useState<{
    blockId: string;
    position: ImageDropPosition;
  } | null>(null);
  const [draggingEditorBlockId, setDraggingEditorBlockId] = useState<string | null>(null);
  const [blockMoveDropTarget, setBlockMoveDropTarget] = useState<BlockMoveDropTarget | null>(null);

  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const bibHighlightScrollRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const saveInFlightRef = useRef(false);
  const titleSaveInFlightRef = useRef(false);
  const legacySyncRequestedRef = useRef(false);
  const imagePreviewFetchRequestedRef = useRef(new Set<string>());
  const draggingEditorBlockIdRef = useRef<string | null>(null);

  useEffect(() => {
    setArticles(initialArticles);
  }, [initialArticles]);

  useEffect(() => {
    draggingEditorBlockIdRef.current = draggingEditorBlockId;
  }, [draggingEditorBlockId]);

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
  const activeFilePath = useMemo(
    () =>
      activeFile?.kind === "file"
        ? (filePathMap.get(activeFile.id) ?? null)
        : null,
    [activeFile, filePathMap],
  );
  const workspaceFilesByPath = useMemo(() => {
    const map = new Map<string, WorkspaceFile>();
    for (const file of files) {
      if (file.kind !== "file") continue;
      const path = filePathMap.get(file.id);
      if (!path) continue;
      map.set(path, file);
    }
    return map;
  }, [filePathMap, files]);
  const isBibWorkspaceFile = Boolean(
    activeFile?.kind === "file" && activeFile.name.toLowerCase().endsWith(".bib"),
  );
  const isImageWorkspaceFile = Boolean(
    activeFile && isWorkspaceImageFile(activeFile),
  );
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

  const blockSourceText = useMemo(
    () => editorBlocksToSource(editorBlocks, sourceFormat),
    [editorBlocks, sourceFormat],
  );
  const bibSourceText = useMemo(() => bibEditorBlocksToSource(editorBlocks), [editorBlocks]);
  const sourceText = useMemo(() => {
    if (isImageWorkspaceFile) return activeFile?.content ?? "";
    return isBibWorkspaceFile ? bibSourceText : blockSourceText;
  }, [activeFile, bibSourceText, blockSourceText, isBibWorkspaceFile, isImageWorkspaceFile]);
  const citationKeys = useMemo(
    () => (isImageWorkspaceFile ? [] : extractCitationKeysFromText(sourceText)),
    [isImageWorkspaceFile, sourceText],
  );
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
      const trimmed = input.trim();
      if (!trimmed) return input;
      const match = trimmed.match(/^workspace:\/\/(.+)$/);
      if (match) {
        const file = files.find((item) => item.id === match[1]);
        if (!file || file.kind !== "file" || !file.content) return trimmed;
        return file.content;
      }
      if (isInlineImageDataUrl(trimmed)) return trimmed;
      const resolvedPath = resolveWorkspacePathFromDocument(trimmed, activeFilePath);
      if (!resolvedPath) return trimmed;
      const file = workspaceFilesByPath.get(resolvedPath);
      if (!file || !file.content) return trimmed;
      return isWorkspaceImageFile(file) ? file.content : trimmed;
    },
    [activeFilePath, files, workspaceFilesByPath],
  );
  useEffect(() => {
    if (!activeFile || activeFile.kind !== "file" || !isImageWorkspaceFile) {
      setActiveImagePreviewSrc(null);
      return;
    }

    const fromContent = deriveImagePreviewSource(activeFile.content, resolveWorkspaceImageSrc);
    if (fromContent) {
      setActiveImagePreviewSrc(fromContent);
      return;
    }

    const fromIdRef = deriveImagePreviewSource(`workspace://${activeFile.id}`, resolveWorkspaceImageSrc);
    if (fromIdRef) {
      setActiveImagePreviewSrc(fromIdRef);
      return;
    }

    if (imagePreviewFetchRequestedRef.current.has(activeFile.id)) {
      setActiveImagePreviewSrc(null);
      return;
    }
    imagePreviewFetchRequestedRef.current.add(activeFile.id);

    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/workspace/files/${encodeURIComponent(activeFile.id)}`, {
          cache: "no-store",
        });
        const data = (await response.json()) as { success?: boolean; file?: WorkspaceFile };
        if (!response.ok || !data.success || !data.file || cancelled) {
          return;
        }

        setFiles((prev) =>
          prev.map((item) => (item.id === data.file?.id ? data.file : item)),
        );
        const resolved =
          deriveImagePreviewSource(data.file.content, resolveWorkspaceImageSrc) ??
          deriveImagePreviewSource(`workspace://${data.file.id}`, resolveWorkspaceImageSrc);
        if (!cancelled) {
          setActiveImagePreviewSrc(resolved);
        }
      } catch {
        if (!cancelled) {
          setActiveImagePreviewSrc(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeFile, isImageWorkspaceFile, resolveWorkspaceImageSrc]);

  const previewBlocks = useMemo(
    () => (isBibWorkspaceFile || isImageWorkspaceFile ? [] : parseSourceToBlocks(sourceText, sourceFormat)),
    [isBibWorkspaceFile, isImageWorkspaceFile, sourceFormat, sourceText],
  );
  const myArticles = useMemo(
    () => articles.filter((article) => article.authorDid === sessionDid),
    [articles, sessionDid],
  );

  const isLoggedIn = Boolean(sessionDid);
  const isExistingArticle = Boolean(currentDid && currentRkey);
  const canEditArticle = Boolean(isLoggedIn && (!isExistingArticle || currentAuthorDid === sessionDid));
  const canEditCurrentFile = Boolean(canEditArticle && activeFile?.kind === "file");
  const canEditTextCurrentFile = canEditCurrentFile && !isImageWorkspaceFile;
  const canPublishCurrentFile = canEditCurrentFile && !isBibWorkspaceFile && !isImageWorkspaceFile;
  const hasOpenDocument = Boolean((activeFile && activeFile.kind === "file") || activeArticleUri);
  const isDirtyFile = useMemo(() => {
    if (!canEditCurrentFile || !activeFile || activeFile.kind !== "file") {
      return false;
    }
    const currentContent = activeFile.content ?? "";
    const currentFormat = activeFile.sourceFormat ?? inferSourceFormat(activeFile.name, null);
    return currentContent !== sourceText || currentFormat !== sourceFormat;
  }, [activeFile, canEditCurrentFile, sourceFormat, sourceText]);
  const isDirtyTitle = useMemo(() => {
    if (!canEditCurrentFile || !activeFile || activeFile.kind !== "file") {
      return false;
    }
    if (isExistingArticle) {
      return false;
    }
    return title.trim() !== defaultTitleFromFileName(activeFile.name);
  }, [activeFile, canEditCurrentFile, isExistingArticle, title]);

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
      if (isWorkspaceImageFile(file)) {
        setEditorBlocks([]);
      } else if (file.name.toLowerCase().endsWith(".bib")) {
        setEditorBlocks(sourceToBibEditorBlocks(file.content ?? ""));
      } else {
        setEditorBlocks(sourceToEditorBlocks(file.content ?? "", format));
      }

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
    void refreshArticles();
  }, [refreshArticles]);

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
    if (!canEditTextCurrentFile || !activeFile || activeFile.kind !== "file") {
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
  }, [activeFile, canEditTextCurrentFile, sourceFormat, sourceText]);

  const persistTitleAsFileName = useCallback(async (options?: { silent?: boolean }) => {
    if (!canEditCurrentFile || !activeFile || activeFile.kind !== "file") {
      return null;
    }
    if (isExistingArticle) {
      return null;
    }
    if (titleSaveInFlightRef.current) {
      return null;
    }

    const nextName = composeFileNameFromTitle(title, activeFile.name);
    if (!nextName) {
      return null;
    }
    if (nextName === activeFile.name) {
      return null;
    }

    titleSaveInFlightRef.current = true;
    try {
      const response = await fetch(`/api/workspace/files/${encodeURIComponent(activeFile.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nextName }),
      });
      const data = (await response.json()) as {
        success?: boolean;
        file?: WorkspaceFile;
        error?: string;
      };
      if (!response.ok || !data.success || !data.file) {
        throw new Error(data.error ?? "Failed to save file name");
      }

      setFiles((prev) => prev.map((item) => (item.id === data.file?.id ? data.file : item)));
      setTitle(defaultTitleFromFileName(data.file.name));
      if (!options?.silent) {
        setStatusMessage(`Renamed to ${data.file.name}`);
      }
      return data.file;
    } finally {
      titleSaveInFlightRef.current = false;
    }
  }, [activeFile, canEditCurrentFile, isExistingArticle, title]);

  useEffect(() => {
    if (!isDirtyFile || !canEditTextCurrentFile) return;

    const timer = window.setTimeout(() => {
      void saveCurrentFile({ silent: true }).catch((err: unknown) => {
        setStatusMessage(err instanceof Error ? err.message : "Failed to autosave file");
      });
    }, 800);

    return () => window.clearTimeout(timer);
  }, [canEditTextCurrentFile, isDirtyFile, saveCurrentFile]);

  useEffect(() => {
    if (!isDirtyTitle || !canEditCurrentFile) return;

    const timer = window.setTimeout(() => {
      void persistTitleAsFileName({ silent: true }).catch((err: unknown) => {
        setStatusMessage(err instanceof Error ? err.message : "Failed to save file name");
      });
    }, 800);

    return () => window.clearTimeout(timer);
  }, [canEditCurrentFile, isDirtyTitle, persistTitleAsFileName]);

  const handlePublish = async () => {
    if (!canEditCurrentFile || !activeFile || activeFile.kind !== "file") {
      setStatusMessage("Select a file and ensure you have edit permission.");
      return;
    }
    if (isImageWorkspaceFile) {
      setStatusMessage("Image files cannot be published.");
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
      if (isBibWorkspaceFile || isImageWorkspaceFile) return;
      if (nextFormat === sourceFormat) return;
      const currentSource = blockSourceText;
      const nextBlocks = sourceToEditorBlocks(currentSource, nextFormat);
      setSourceFormat(nextFormat);
      setEditorBlocks(nextBlocks);
      setCitationMenu(null);
      setBlockMenuForId(null);
      setActiveBlockId(null);
    },
    [blockSourceText, isBibWorkspaceFile, isImageWorkspaceFile, sourceFormat],
  );

  const normalizeBibtexBlock = useCallback((raw: string): string => {
    const normalized = raw.replace(/\r\n?/g, "\n").trim();
    if (!normalized) return "";
    return formatBibtexSource(normalized);
  }, []);

  const formatBibtexBlockById = useCallback(
    (blockId: string, raw: string) => {
      const formatted = normalizeBibtexBlock(raw);
      setEditorBlocks((prev) =>
        prev.map((block) =>
          block.id === blockId && block.text !== formatted
            ? { ...block, kind: "paragraph", text: formatted }
            : block,
        ),
      );
    },
    [normalizeBibtexBlock],
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

  const hasDraggedImageData = (event: DragEvent<HTMLElement>): boolean =>
    Array.from(event.dataTransfer.items ?? []).some(
      (item) => item.kind === "file" && item.type.startsWith("image/"),
    );
  const BLOCK_DRAG_MIME = "application/x-scholarview-editor-block";
  const hasDraggedEditorBlock = (event: DragEvent<HTMLElement>): boolean =>
    Array.from(event.dataTransfer.types ?? []).includes(BLOCK_DRAG_MIME) || Boolean(draggingEditorBlockId);

  const determineBlockDropPosition = (event: DragEvent<HTMLElement>): ImageDropPosition => {
    const rect = event.currentTarget.getBoundingClientRect();
    const offsetY = event.clientY - rect.top;
    return offsetY < rect.height / 2 ? "before" : "after";
  };

  const handleImageDrop = async (
    event: DragEvent<HTMLElement>,
    insertAt?: { blockId: string; position: ImageDropPosition } | null,
  ) => {
    if (
      !canEditTextCurrentFile ||
      isBibWorkspaceFile ||
      !sessionDid ||
      !activeFile ||
      activeFile.kind !== "file"
    ) {
      return;
    }
    const dropped = Array.from(event.dataTransfer.files ?? []).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (dropped.length === 0) return;

    event.preventDefault();
    event.stopPropagation();

    try {
      const findInsertIndex = (): number => {
        if (insertAt?.blockId) {
          const blockIndex = editorBlocks.findIndex((block) => block.id === insertAt.blockId);
          if (blockIndex >= 0) {
            return insertAt.position === "before" ? blockIndex : blockIndex + 1;
          }
        }

        const fromTarget =
          event.target instanceof HTMLElement
            ? event.target.closest<HTMLElement>("[data-editor-block-id]")?.dataset.editorBlockId
            : undefined;
        if (fromTarget) {
          const blockIndex = editorBlocks.findIndex((block) => block.id === fromTarget);
          if (blockIndex >= 0) return blockIndex + 1;
        }

        const activeElement = document.activeElement;
        if (activeElement instanceof HTMLElement) {
          const fromFocusedElement =
            activeElement.closest<HTMLElement>("[data-editor-block-id]")?.dataset.editorBlockId;
          if (fromFocusedElement) {
            const blockIndex = editorBlocks.findIndex((block) => block.id === fromFocusedElement);
            if (blockIndex >= 0) return blockIndex + 1;
          }
        }

        if (activeBlockId) {
          const activeIndex = editorBlocks.findIndex((block) => block.id === activeBlockId);
          if (activeIndex >= 0) return activeIndex + 1;
        }
        return editorBlocks.length;
      };

      let insertIndex = findInsertIndex();
      let lastInsertedId: string | null = null;
      const targetFolderId = activeFile.parentId;
      const targetFolderPath = targetFolderId ? (filePathMap.get(targetFolderId) ?? "") : "";
      const takenImageNames = new Set(
        files
          .filter((file) => file.kind === "file" && file.parentId === targetFolderId)
          .map((file) => file.name.toLowerCase()),
      );
      for (const image of dropped) {
        const dataUrl = await readFileAsDataUrl(image);
        const ext = inferImageExtension(image.name, image.type);
        const stem = sanitizeFileStem(image.name);
        const fileName = createUniqueImageFileName(stem, ext, takenImageNames);
        const response = await fetch("/api/workspace/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            parentId: targetFolderId,
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
        const imagePath = normalizeWorkspacePath(`${targetFolderPath}/${fileName}`);
        const token = `![${stem}](${imagePath}){#${figureLabel} width=0.8 align=center}`;
        const insertedId = newId();
        setEditorBlocks((prev) => {
          const next = [...prev];
          const clamped = Math.max(0, Math.min(insertIndex, next.length));
          next.splice(clamped, 0, { id: insertedId, kind: "paragraph", text: token });
          return next;
        });
        insertIndex += 1;
        lastInsertedId = insertedId;
      }
      if (lastInsertedId) {
        setActiveBlockId(lastInsertedId);
      }
      await loadFiles();
      setStatusMessage("Inserted image figure block(s).");
    } catch (err: unknown) {
      setStatusMessage(err instanceof Error ? err.message : "Failed to insert image");
    } finally {
      setImageDropTarget(null);
      setBlockMoveDropTarget(null);
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

      const oldDraggedPath = filePathMap.get(dragged.id) ?? null;
      const nextFiles = files.map((file) => {
        const update = deduped.get(file.id);
        if (!update) return file;
        return {
          ...file,
          parentId: update.parentId !== undefined ? update.parentId : file.parentId,
          sortOrder: update.sortOrder,
        };
      });
      const nextFilePathMap = buildFilePathMap(nextFiles);
      const nextDraggedPath = nextFilePathMap.get(dragged.id) ?? null;

      await Promise.all(
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

      let rewrittenCount = 0;
      if (
        isWorkspaceImageFile(dragged) &&
        oldDraggedPath &&
        nextDraggedPath &&
        oldDraggedPath !== nextDraggedPath
      ) {
        const contentUpdates = nextFiles
          .filter((file) => {
            if (file.kind !== "file") return false;
            if (isWorkspaceImageFile(file)) return false;
            if (file.name.toLowerCase().endsWith(".bib")) return false;
            return inferSourceFormat(file.name, file.sourceFormat) === "markdown";
          })
          .map((file) => {
            const documentPath = nextFilePathMap.get(file.id) ?? null;
            const source =
              file.id === activeFileId && canEditTextCurrentFile
                ? sourceText
                : (file.content ?? "");
            const nextContent = rewriteImagePathReferencesInMarkdown(source, {
              movedFileId: dragged.id,
              oldPath: oldDraggedPath,
              newPath: nextDraggedPath,
              documentPath,
            });
            if (nextContent === source) return null;
            return { file, nextContent };
          })
          .filter((item): item is { file: WorkspaceFile; nextContent: string } => item !== null);

        if (contentUpdates.length > 0) {
          await Promise.all(
            contentUpdates.map(async ({ file, nextContent }) => {
              const response = await fetch(`/api/workspace/files/${encodeURIComponent(file.id)}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  content: nextContent,
                  sourceFormat: inferSourceFormat(file.name, file.sourceFormat),
                }),
              });
              const data = (await response.json()) as { success?: boolean; error?: string };
              if (!response.ok || !data.success) {
                throw new Error(data.error ?? "Failed to update image references");
              }
            }),
          );
          rewrittenCount = contentUpdates.length;

          const activeUpdate = contentUpdates.find((item) => item.file.id === activeFileId);
          if (activeUpdate && sourceFormat === "markdown") {
            setEditorBlocks(sourceToEditorBlocks(activeUpdate.nextContent, sourceFormat));
          }
        }
      }

      await loadFiles();
      setStatusMessage(
        rewrittenCount > 0
          ? `Updated file order and ${rewrittenCount} image reference file(s).`
          : "Updated file order.",
      );
    },
    [
      activeFileId,
      canEditTextCurrentFile,
      filePathMap,
      files,
      loadFiles,
      sessionDid,
      sourceFormat,
      sourceText,
    ],
  );

  const updateBlock = (id: string, patch: Partial<EditorBlock>) => {
    setEditorBlocks((prev) => prev.map((block) => (block.id === id ? { ...block, ...patch } : block)));
  };

  const insertBlockAfter = (
    index: number,
    kind: BlockKind = "paragraph",
    options?: { text?: string; selectionStart?: number; selectionEnd?: number },
  ) => {
    const block = { id: newId(), kind, text: options?.text ?? "" };
    const selectionStart = options?.selectionStart ?? 0;
    const selectionEnd = options?.selectionEnd ?? selectionStart;
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
          retry.setSelectionRange(selectionStart, selectionEnd);
          resizeTextarea(retry);
        }, 0);
        return;
      }
      textarea.focus();
      textarea.setSelectionRange(selectionStart, selectionEnd);
      resizeTextarea(textarea);
    }, 0);
  };

  const focusBlockByIndex = (
    index: number,
    options?: {
      position?: "start" | "end";
    },
  ) => {
    const block = editorBlocks[index];
    if (!block) return;
    setActiveBlockId(block.id);
    setBlockMenuForId(null);
    setCitationMenu(null);
    window.setTimeout(() => {
      const textarea = textareaRefs.current[block.id];
      if (!textarea) return;
      textarea.focus();
      const position = options?.position === "start" ? 0 : textarea.value.length;
      textarea.setSelectionRange(position, position);
      resizeTextarea(textarea);
    }, 0);
  };

  const activateBlockEditor = (blockId: string, position: "start" | "end" = "start") => {
    setActiveBlockId(blockId);
    setBlockMenuForId(null);
    setCitationMenu(null);
    const focusWithRetry = (attempt = 0) => {
      const textarea = textareaRefs.current[blockId];
      if (!textarea) {
        if (attempt < 6) {
          window.setTimeout(() => focusWithRetry(attempt + 1), 0);
        }
        return;
      }
      textarea.focus();
      const nextPosition = position === "end" ? textarea.value.length : 0;
      textarea.setSelectionRange(nextPosition, nextPosition);
      resizeTextarea(textarea);
    };
    window.setTimeout(() => {
      focusWithRetry();
    }, 0);
  };

  const moveBlockByDelta = (index: number, delta: -1 | 1) => {
    if (!canEditTextCurrentFile) return;
    let movedId: string | null = null;
    setEditorBlocks((prev) => {
      const target = index + delta;
      if (index < 0 || index >= prev.length || target < 0 || target >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      if (!moved) return prev;
      next.splice(target, 0, moved);
      movedId = moved.id;
      return next;
    });
    setBlockMenuForId(null);
    setCitationMenu(null);
    if (movedId) {
      activateBlockEditor(movedId, "start");
    }
  };

  const moveBlockByDrop = (draggedId: string, targetId: string, position: ImageDropPosition) => {
    if (!canEditTextCurrentFile) return;
    if (draggedId === targetId) return;
    let movedId: string | null = null;
    setEditorBlocks((prev) => {
      const from = prev.findIndex((block) => block.id === draggedId);
      const to = prev.findIndex((block) => block.id === targetId);
      if (from < 0 || to < 0) return prev;

      const next = [...prev];
      const [moved] = next.splice(from, 1);
      if (!moved) return prev;
      let insertAt = position === "before" ? to : to + 1;
      if (from < insertAt) insertAt -= 1;
      insertAt = Math.max(0, Math.min(insertAt, next.length));
      next.splice(insertAt, 0, moved);
      movedId = moved.id;
      return next;
    });
    setBlockMenuForId(null);
    setCitationMenu(null);
    if (movedId) {
      activateBlockEditor(movedId, "start");
    }
  };

  const handleEditorCanvasClick = (event: React.MouseEvent<HTMLElement>) => {
    if (!canEditTextCurrentFile) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target !== event.currentTarget) return;
    if (target.closest("[data-editor-block-id]")) return;
    if (target.closest("textarea,button,input,select,a,label,[role='button']")) return;

    if (editorBlocks.length === 0) {
      const created = { id: newId(), kind: "paragraph" as const, text: "" };
      setEditorBlocks([created]);
      setActiveBlockId(created.id);
      setBlockMenuForId(null);
      setCitationMenu(null);
      window.setTimeout(() => {
        const textarea = textareaRefs.current[created.id];
        if (!textarea) return;
        textarea.focus();
        textarea.setSelectionRange(0, 0);
        resizeTextarea(textarea);
      }, 0);
      return;
    }

    focusBlockByIndex(editorBlocks.length - 1, { position: "end" });
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

      <div className="grid min-h-[calc(100vh-4rem)] grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)_360px]">
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
          className="min-w-0 rounded-xl border bg-white p-4 shadow-sm"
          onClick={handleEditorCanvasClick}
          onDragOver={(event) => {
            if (!canEditTextCurrentFile) return;
            if (hasDraggedEditorBlock(event)) {
              event.preventDefault();
              if (imageDropTarget !== null) {
                setImageDropTarget(null);
              }
              return;
            }
            if (isBibWorkspaceFile) return;
            if (!hasDraggedImageData(event)) return;
            event.preventDefault();
            if (imageDropTarget !== null) {
              setImageDropTarget(null);
            }
          }}
          onDragLeave={() => {
            if (imageDropTarget !== null) {
              setImageDropTarget(null);
            }
            if (blockMoveDropTarget !== null) {
              setBlockMoveDropTarget(null);
            }
          }}
          onDrop={(event) => {
            if (hasDraggedEditorBlock(event)) {
              event.preventDefault();
              setDraggingEditorBlockId(null);
              setBlockMoveDropTarget(null);
              return;
            }
            void handleImageDrop(event, imageDropTarget);
            setBlockMoveDropTarget(null);
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
                  onBlur={() => {
                    if (!title.trim()) {
                      if (activeFile?.kind === "file") {
                        setTitle(defaultTitleFromFileName(activeFile.name));
                      }
                      return;
                    }
                    void persistTitleAsFileName({ silent: true }).catch((err: unknown) => {
                      setStatusMessage(err instanceof Error ? err.message : "Failed to save file name");
                    });
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    if (!title.trim()) {
                      if (activeFile?.kind === "file") {
                        setTitle(defaultTitleFromFileName(activeFile.name));
                      }
                      e.currentTarget.blur();
                      return;
                    }
                    void persistTitleAsFileName({ silent: true }).catch((err: unknown) => {
                      setStatusMessage(err instanceof Error ? err.message : "Failed to save file name");
                    });
                    e.currentTarget.blur();
                  }}
                  readOnly={!canEditCurrentFile}
                  className="w-full border-none bg-transparent text-3xl font-semibold outline-none"
                  placeholder="Untitled"
                />

                <div className="relative flex items-center gap-2">
                  {canEditCurrentFile ? (
                    <span className="text-xs text-slate-500">
                      {savingFile ? "Saving..." : isDirtyFile || isDirtyTitle ? "Unsaved changes" : "Saved"}
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

                  {canEditTextCurrentFile && !isBibWorkspaceFile ? (
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
                          {isBibWorkspaceFile ? (
                            <p className="mb-2 text-xs text-slate-500">BibTeX files use code view only.</p>
                          ) : (
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
                          )}

                          <label className="mb-2 flex items-center gap-2 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              checked={broadcastToBsky}
                              onChange={(e) => setBroadcastToBsky(e.target.checked)}
                            />
                            Bluesky Sync
                          </label>

                          {!isBibWorkspaceFile ? (
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
                          ) : null}

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

              <div className="min-h-[18rem]">
                {isImageWorkspaceFile ? (
                  <div className="space-y-3">
                    <p className="text-xs text-slate-500">Image Preview</p>
                    <div className="flex min-h-[18rem] items-center justify-center rounded-md border bg-slate-50 p-3">
                      {activeImagePreviewSrc ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={activeImagePreviewSrc}
                          alt={activeFile?.name ?? "image"}
                          className="max-h-[70vh] w-auto max-w-full rounded border bg-white object-contain"
                        />
                      ) : (
                        <p className="text-sm text-slate-500">No image data.</p>
                      )}
                    </div>
                  </div>
                ) : isBibWorkspaceFile ? (
                  <div className="space-y-3">
                    <p className="text-xs text-slate-500">BibTeX Code View</p>
                    <div className="space-y-1">
                      {editorBlocks.map((block, index) => (
                        <div
                          key={block.id}
                          data-editor-block-id={block.id}
                          className={`group flex items-start gap-2 rounded-md px-0.5 py-0.5 ${
                            activeBlockId === block.id ? "bg-slate-50/70" : "hover:bg-slate-50/60"
                          }`}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (!canEditCurrentFile) return;
                            const target = event.target;
                            if (
                              target instanceof HTMLElement &&
                              target.closest("button,input,select,textarea,a,label,[role='button']")
                            ) {
                              return;
                            }
                            activateBlockEditor(block.id, "start");
                          }}
                        >
                          <div className="mt-1 w-7 shrink-0 text-center text-[11px] text-slate-400">
                            {index + 1}
                          </div>
                          <div className="min-w-0 w-full">
                            {canEditCurrentFile && activeBlockId === block.id ? (
                              <div className="relative max-w-full rounded border bg-white">
                                <div
                                  ref={(el) => {
                                    bibHighlightScrollRefs.current[block.id] = el;
                                  }}
                                  aria-hidden
                                  className="pointer-events-none absolute inset-0 overflow-x-auto px-2 py-1"
                                >
                                  <p className="whitespace-pre font-mono text-xs leading-6 text-slate-800">
                                    {block.text.length > 0
                                      ? renderBibtexHighlighted(block.text, `editor-bib-active-${block.id}`)
                                      : " "}
                                  </p>
                                </div>
                                <textarea
                                  data-editor-block-id={block.id}
                                  ref={(el) => {
                                    textareaRefs.current[block.id] = el;
                                    resizeTextarea(el);
                                  }}
                                  value={block.text}
                                  readOnly={!canEditCurrentFile}
                                  rows={1}
                                  wrap="off"
                                  spellCheck={false}
                                  onScroll={(event) => {
                                    const overlay = bibHighlightScrollRefs.current[block.id];
                                    if (!overlay) return;
                                    overlay.scrollLeft = event.currentTarget.scrollLeft;
                                    overlay.scrollTop = event.currentTarget.scrollTop;
                                  }}
                                  onFocus={() => setActiveBlockId(block.id)}
                                  onBlur={(event) => {
                                    const nextFocusedElement =
                                      event.relatedTarget instanceof HTMLElement ? event.relatedTarget : null;
                                    formatBibtexBlockById(block.id, event.currentTarget.value);
                                    window.setTimeout(() => {
                                      if (draggingEditorBlockIdRef.current === block.id) return;
                                      if (
                                        nextFocusedElement &&
                                        nextFocusedElement.closest(`[data-editor-block-id="${block.id}"]`)
                                      ) {
                                        return;
                                      }
                                      setActiveBlockId((prev) => (prev === block.id ? null : prev));
                                    }, 0);
                                  }}
                                  onChange={(event) => {
                                    updateBlock(block.id, { kind: "paragraph", text: event.target.value });
                                    resizeTextarea(event.target);
                                  }}
                                  onKeyDown={(event) => {
                                    if (!canEditCurrentFile) return;
                                    if ((event.metaKey || event.ctrlKey) && event.shiftKey) {
                                      if (event.key === "ArrowUp") {
                                        event.preventDefault();
                                        moveBlockByDelta(index, -1);
                                        return;
                                      }
                                      if (event.key === "ArrowDown") {
                                        event.preventDefault();
                                        moveBlockByDelta(index, 1);
                                        return;
                                      }
                                    }
                                    const selectionStart = event.currentTarget.selectionStart;
                                    const selectionEnd = event.currentTarget.selectionEnd;
                                    const atStart = selectionStart === 0 && selectionEnd === 0;
                                    const atEnd =
                                      selectionStart === event.currentTarget.value.length &&
                                      selectionEnd === event.currentTarget.value.length;
                                    if (event.key === "ArrowUp" && atStart && index > 0) {
                                      event.preventDefault();
                                      focusBlockByIndex(index - 1, { position: "end" });
                                      return;
                                    }
                                    if (event.key === "ArrowDown" && atEnd && index < editorBlocks.length - 1) {
                                      event.preventDefault();
                                      focusBlockByIndex(index + 1, { position: "start" });
                                      return;
                                    }
                                    if (
                                      event.key === "Enter" &&
                                      !event.shiftKey &&
                                      atEnd &&
                                      isClosedBibtexEntryBlock(block.text)
                                    ) {
                                      event.preventDefault();
                                      const template = createBibtexTemplate(sourceText);
                                      insertBlockAfter(index, "paragraph", template);
                                      return;
                                    }
                                    if (event.key === "Enter" && event.shiftKey) {
                                      event.preventDefault();
                                      const template = createBibtexTemplate(sourceText);
                                      insertBlockAfter(index, "paragraph", template);
                                      return;
                                    }
                                    if (
                                      event.key === "Backspace" &&
                                      block.text.length === 0 &&
                                      editorBlocks.length > 1
                                    ) {
                                      event.preventDefault();
                                      removeBlock(index);
                                    }
                                  }}
                                  placeholder="@article{citation_key, ...}"
                                  className="relative z-10 max-w-full w-full resize-none overflow-x-auto whitespace-pre bg-transparent px-2 py-1 font-mono text-xs leading-6 text-transparent caret-slate-800 outline-none selection:bg-sky-300/30 selection:text-transparent"
                                />
                              </div>
                            ) : (
                              <div
                                role={canEditCurrentFile ? "button" : undefined}
                                tabIndex={canEditCurrentFile ? 0 : undefined}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (!canEditCurrentFile) return;
                                  activateBlockEditor(block.id, "start");
                                }}
                                onKeyDown={(event) => {
                                  if (!canEditCurrentFile) return;
                                  if (event.key !== "Enter" && event.key !== " ") return;
                                  event.preventDefault();
                                  activateBlockEditor(block.id, "start");
                                }}
                                className={`min-h-[1.75rem] min-w-0 w-full rounded border bg-white px-2 py-1 ${
                                  canEditCurrentFile ? "cursor-text" : ""
                                }`}
                              >
                                {block.text.trim().length > 0 ? (
                                  <div className="max-w-full overflow-x-auto">
                                    <p className="whitespace-pre font-mono text-xs leading-6 text-slate-800">
                                      {renderBibtexHighlighted(
                                        block.text,
                                        `editor-bib-block-preview-${block.id}`,
                                      )}
                                    </p>
                                  </div>
                                ) : (
                                  <p className="font-mono text-xs text-slate-400">
                                    {"@article{citation_key, ...}"}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-slate-500">{parseBibtexEntries(sourceText).length} entries detected.</p>
                  </div>
                ) : (
                  <>
                    <div className="space-y-0.5">
                  {editorBlocks.map((block, index) => (
                    (() => {
                      const imageLine = block.kind === "paragraph" ? parseMarkdownImageLine(block.text) : null;
                      const imageAlign = imageLine ? imageAlignFromAttrs(imageLine.attrs) : "center";
                      return (
                    <div
                      key={block.id}
                      data-editor-block="true"
                      data-editor-block-id={block.id}
                      className={`group flex items-start gap-2 rounded-md px-0.5 py-0.5 ${
                        activeBlockId === block.id ? "bg-slate-50/70" : "hover:bg-slate-50/60"
                      } ${
                        blockMoveDropTarget?.blockId === block.id && blockMoveDropTarget.position === "before"
                          ? "border-t-2 border-emerald-500"
                          : blockMoveDropTarget?.blockId === block.id &&
                              blockMoveDropTarget.position === "after"
                            ? "border-b-2 border-emerald-500"
                            : imageDropTarget?.blockId === block.id && imageDropTarget.position === "before"
                              ? "border-t-2 border-[#0085FF]"
                              : imageDropTarget?.blockId === block.id &&
                                  imageDropTarget.position === "after"
                                ? "border-b-2 border-[#0085FF]"
                                : ""
                      }`}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!canEditCurrentFile) return;
                        const target = event.target;
                        if (
                          target instanceof HTMLElement &&
                          target.closest("button,input,select,textarea,a,label,[role='button']")
                        ) {
                          return;
                        }
                        activateBlockEditor(block.id, "start");
                      }}
                      onDragOver={(event) => {
                        if (!canEditTextCurrentFile) return;
                        if (hasDraggedEditorBlock(event)) {
                          const draggedId =
                            event.dataTransfer.getData(BLOCK_DRAG_MIME) || draggingEditorBlockId;
                          if (!draggedId || draggedId === block.id) return;
                          event.preventDefault();
                          event.stopPropagation();
                          const position = determineBlockDropPosition(event);
                          if (
                            blockMoveDropTarget?.blockId !== block.id ||
                            blockMoveDropTarget.position !== position
                          ) {
                            setBlockMoveDropTarget({ blockId: block.id, position });
                          }
                          if (imageDropTarget !== null) {
                            setImageDropTarget(null);
                          }
                          return;
                        }
                        if (isBibWorkspaceFile) return;
                        if (!hasDraggedImageData(event)) return;
                        event.preventDefault();
                        event.stopPropagation();
                        const position = determineBlockDropPosition(event);
                        if (
                          imageDropTarget?.blockId !== block.id ||
                          imageDropTarget.position !== position
                        ) {
                          setImageDropTarget({ blockId: block.id, position });
                        }
                      }}
                      onDrop={(event) => {
                        if (!canEditTextCurrentFile) return;
                        if (hasDraggedEditorBlock(event)) {
                          const draggedId =
                            event.dataTransfer.getData(BLOCK_DRAG_MIME) || draggingEditorBlockId;
                          const position = determineBlockDropPosition(event);
                          event.preventDefault();
                          event.stopPropagation();
                          if (draggedId && draggedId !== block.id) {
                            moveBlockByDrop(draggedId, block.id, position);
                          }
                          setDraggingEditorBlockId(null);
                          setBlockMoveDropTarget(null);
                          return;
                        }
                        if (isBibWorkspaceFile) return;
                        const position = determineBlockDropPosition(event);
                        event.stopPropagation();
                        void handleImageDrop(event, { blockId: block.id, position });
                      }}
                    >
                      <div className="relative mt-1 w-5 shrink-0">
                        {canEditCurrentFile &&
                        (activeBlockId === block.id || draggingEditorBlockId === block.id) ? (
                          <>
                            <button
                              type="button"
                              draggable
                              onDragStart={(event) => {
                                setDraggingEditorBlockId(block.id);
                                setBlockMoveDropTarget(null);
                                setImageDropTarget(null);
                                event.dataTransfer.setData(BLOCK_DRAG_MIME, block.id);
                                event.dataTransfer.effectAllowed = "move";
                              }}
                              onDragEnd={() => {
                                setDraggingEditorBlockId(null);
                                setBlockMoveDropTarget(null);
                              }}
                              onClick={() => {
                                setActiveBlockId(block.id);
                                setBlockMenuForId((prev) => (prev === block.id ? null : block.id));
                              }}
                              className={`flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-600 ${
                                draggingEditorBlockId === block.id ? "cursor-grabbing" : "cursor-grab"
                              }`}
                              title="Drag to move block"
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
                            {imageLine ? (
                              <div className="mb-1 flex items-center gap-1 text-xs">
                                {(["left", "center", "right"] as const).map((align) => (
                                  <button
                                    key={align}
                                    type="button"
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => {
                                      updateBlock(block.id, {
                                        text: setImageAlignOnMarkdownLine(block.text, align),
                                      });
                                    }}
                                    className={`rounded border px-2 py-0.5 ${
                                      imageAlign === align
                                        ? "border-[#0085FF] bg-[#E7F2FF] text-[#0068CC]"
                                        : "text-slate-600 hover:bg-slate-50"
                                    }`}
                                  >
                                    {align === "left" ? "Left" : align === "right" ? "Right" : "Center"}
                                  </button>
                                ))}
                              </div>
                            ) : null}
                            <textarea
                              data-editor-block-id={block.id}
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
                              onBlur={(event) => {
                                const nextFocusedElement =
                                  event.relatedTarget instanceof HTMLElement ? event.relatedTarget : null;
                                window.setTimeout(() => {
                                  if (citationMenu?.blockId === block.id) return;
                                  if (draggingEditorBlockIdRef.current === block.id) return;
                                  if (
                                    nextFocusedElement &&
                                    nextFocusedElement.closest(`[data-editor-block-id="${block.id}"]`)
                                  ) {
                                    return;
                                  }
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
                                if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
                                  if (e.key === "ArrowUp") {
                                    e.preventDefault();
                                    moveBlockByDelta(index, -1);
                                    return;
                                  }
                                  if (e.key === "ArrowDown") {
                                    e.preventDefault();
                                    moveBlockByDelta(index, 1);
                                    return;
                                  }
                                }

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

                                const selectionStart = e.currentTarget.selectionStart;
                                const selectionEnd = e.currentTarget.selectionEnd;
                                const atStart = selectionStart === 0 && selectionEnd === 0;
                                const atEnd =
                                  selectionStart === e.currentTarget.value.length &&
                                  selectionEnd === e.currentTarget.value.length;
                                if (e.key === "ArrowUp" && atStart && index > 0) {
                                  e.preventDefault();
                                  focusBlockByIndex(index - 1, { position: "end" });
                                  return;
                                }
                                if (e.key === "ArrowDown" && atEnd && index < editorBlocks.length - 1) {
                                  e.preventDefault();
                                  focusBlockByIndex(index + 1, { position: "start" });
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
                              event.stopPropagation();
                              if (!canEditCurrentFile) return;
                              const target = event.target;
                              if (target instanceof HTMLElement && target.closest("a")) {
                                return;
                              }
                              activateBlockEditor(block.id, "start");
                            }}
                            onKeyDown={(event) => {
                              if (!canEditCurrentFile) return;
                              if (event.key !== "Enter" && event.key !== " ") return;
                              event.preventDefault();
                              activateBlockEditor(block.id, "start");
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
                      );
                    })()
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
              </div>
            </>
          )}
        </section>

        <aside data-tour-id="right-panel" className="min-w-0 rounded-xl border bg-white p-3 shadow-sm">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Discussion</p>

          {tab === "preview" ? (
            <div className="space-y-3" onMouseUp={captureWindowSelection}>
              {isImageWorkspaceFile ? (
                <>
                  <p className="text-xs text-slate-500">Image Preview</p>
                  <div className="flex min-h-[18rem] items-center justify-center rounded-md border bg-slate-50 p-3">
                    {activeImagePreviewSrc ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={activeImagePreviewSrc}
                        alt={activeFile?.name ?? "image"}
                        className="max-h-[70vh] w-auto max-w-full rounded border bg-white object-contain"
                      />
                    ) : (
                      <p className="text-sm text-slate-500">No image data.</p>
                    )}
                  </div>
                </>
              ) : isBibWorkspaceFile ? (
                <>
                  <p className="text-xs text-slate-500">BibTeX Preview</p>
                  <div className="max-w-full overflow-x-auto overflow-y-auto rounded-md border bg-white p-3">
                    <p className="whitespace-pre font-mono text-xs leading-6 text-slate-800">
                      {sourceText.trim()
                        ? renderBibtexHighlighted(formatBibtexSource(sourceText), "preview-bib")
                        : "No entries yet."}
                    </p>
                  </div>
                </>
              ) : sourceFormat === "markdown" ? (
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
              {!isBibWorkspaceFile && !isImageWorkspaceFile && resolvedBibliography.length > 0 ? (
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
              {!isBibWorkspaceFile && !isImageWorkspaceFile && missingCitationKeys.length > 0 ? (
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
