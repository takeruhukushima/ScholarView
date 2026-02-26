import { ArticleBlock, parseMarkdownToBlocks, parseTexToBlocks } from "../articles/blocks";
import { parseBibtexEntries, splitBibtexSourceBlocks } from "../articles/citations";
import { SourceFormat } from "../types";
import { BlockKind, EditorBlock } from "./types";
import { newId } from "./utils";

export function inferSourceFormat(name: string, current: SourceFormat | null): SourceFormat {
  if (current) return current;
  return name.toLowerCase().endsWith(".tex") ? "tex" : "markdown";
}

export function levelToKind(level: number): BlockKind {
  if (level <= 1) return "h1";
  if (level === 2) return "h2";
  if (level === 3) return "h3";
  return "paragraph";
}

export function kindToMarkdownPrefix(kind: BlockKind): string {
  if (kind === "h1") return "# ";
  if (kind === "h2") return "## ";
  if (kind === "h3") return "### ";
  return "";
}

export function kindToTexPrefix(kind: BlockKind): string {
  if (kind === "h1") return "\\section{";
  if (kind === "h2") return "\\subsection{";
  if (kind === "h3") return "\\subsubsection{";
  return "";
}

export function headingHashToKind(value: string): BlockKind {
  if (value.length <= 1) return "h1";
  if (value.length === 2) return "h2";
  return "h3";
}

export function normalizeEditedBlockInput(
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

export function detectCitationTrigger(
  text: string,
  cursor: number,
): { start: number; end: number; query: string } | null {
  const before = text.slice(0, cursor);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;

  const prefix = at === 0 ? "" : before[at - 1];
  const hasBracketPrefix = prefix === "[";
  if (!hasBracketPrefix && prefix && /[A-Za-z0-9:_-]/.test(prefix)) {
    return null;
  }

  const query = before.slice(at + 1);
  if (/[^A-Za-z0-9:_-]/.test(query)) {
    return null;
  }

  return { start: hasBracketPrefix ? at - 1 : at, end: cursor, query };
}

export function sourceToEditorBlocks(source: string, sourceFormat: SourceFormat): EditorBlock[] {
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

export function editorBlocksToSource(blocks: EditorBlock[], sourceFormat: SourceFormat): string {
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

export function sourceToBibEditorBlocks(source: string): EditorBlock[] {
  const chunks = splitBibtexSourceBlocks(source);
  if (chunks.length === 0) {
    return [{ id: newId(), kind: "paragraph", text: "" }];
  }
  return chunks.map((text) => ({ id: newId(), kind: "paragraph", text }));
}

export function bibEditorBlocksToSource(blocks: EditorBlock[]): string {
  const normalized = blocks
    .map((block) => block.text.replace(/\r\n?/g, "\n").trim())
    .filter(Boolean);
  return normalized.join("\n\n").trim();
}

export function isClosedBibtexEntryBlock(text: string): boolean {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return false;
  if (!/[})]\s*$/.test(normalized)) return false;
  const parsed = parseBibtexEntries(normalized);
  return parsed.length === 1 && parsed[0].rawBibtex === normalized;
}

export function createBibtexTemplate(source: string): {
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

export function blocksToSource(blocks: ArticleBlock[], sourceFormat: SourceFormat): string {
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
