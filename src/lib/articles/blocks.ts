import type { Block } from "@/lexicons/sci/peer/article.defs";

export type ArticleBlock = Omit<Block, "$type">;

const MAX_BLOCKS = 200;
const MAX_HEADING_LENGTH = 200;
const MAX_CONTENT_LENGTH = 20_000;

function clampLevel(level: number): 1 | 2 | 3 | 4 | 5 | 6 {
  if (level < 2) return 1;
  if (level > 6) return 6;
  return level as 1 | 2 | 3 | 4 | 5 | 6;
}

function normalizeHeading(heading: string, index: number): string {
  const trimmed = heading.trim();
  if (!trimmed) return `Section ${index + 1}`;
  return trimmed.slice(0, MAX_HEADING_LENGTH);
}

function normalizeContent(content: string): string {
  return content.replace(/\r\n?/g, "\n").trim().slice(0, MAX_CONTENT_LENGTH);
}

function normalizeBlock(block: ArticleBlock, index: number): ArticleBlock {
  return {
    level: clampLevel(block.level),
    heading: normalizeHeading(block.heading, index),
    content: normalizeContent(block.content),
  };
}

export function normalizeBlocks(input: unknown): ArticleBlock[] {
  if (!Array.isArray(input)) return [];

  const blocks: ArticleBlock[] = [];
  for (const item of input) {
    if (typeof item !== "object" || item === null) continue;
    const candidate = item as {
      level?: unknown;
      heading?: unknown;
      content?: unknown;
    };

    if (
      typeof candidate.level !== "number" ||
      typeof candidate.heading !== "string" ||
      typeof candidate.content !== "string"
    ) {
      continue;
    }

    blocks.push(
      normalizeBlock(
        {
          level: candidate.level,
          heading: candidate.heading,
          content: candidate.content,
        },
        blocks.length,
      ),
    );

    if (blocks.length >= MAX_BLOCKS) break;
  }

  return blocks;
}

export function parseMarkdownToBlocks(markdown: string): ArticleBlock[] {
  const source = markdown.replace(/\r\n?/g, "\n");
  const lines = source.split("\n");

  const blocks: ArticleBlock[] = [];
  let currentHeading: string | null = null;
  let currentLevel: 1 | 2 | 3 | 4 | 5 | 6 = 1;
  let contentLines: string[] = [];

  const flush = () => {
    const hasText = contentLines.some((line) => line.trim().length > 0);
    if (!hasText && currentHeading === null) {
      contentLines = [];
      return;
    }

    const heading = currentHeading ?? "Overview";
    const content = contentLines.join("\n");

    blocks.push(
      normalizeBlock(
        {
          level: currentLevel,
          heading,
          content,
        },
        blocks.length,
      ),
    );

    contentLines = [];
  };

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (headingMatch) {
      if (currentHeading !== null || contentLines.some((l) => l.trim().length > 0)) {
        flush();
      }

      currentLevel = headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      currentHeading = headingMatch[2];
      continue;
    }

    contentLines.push(line);
  }

  flush();

  return blocks.slice(0, MAX_BLOCKS);
}

export function serializeBlocks(blocks: ArticleBlock[]): string {
  return JSON.stringify(blocks);
}

export function deserializeBlocks(raw: string): ArticleBlock[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return normalizeBlocks(parsed);
  } catch {
    return [];
  }
}
