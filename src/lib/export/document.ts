import type { ArticleBlock } from "@/lib/articles/blocks";
import { parseMarkdownToBlocks, parseTexToBlocks } from "@/lib/articles/blocks";
import {
  type BibliographyEntry,
  formatBibliographyIEEE,
} from "@/lib/articles/citations";
import type { SourceFormat } from "@/lib/types";

export interface ExportResult {
  content: string;
  warnings: string[];
}

function parseFigureAttrs(attrs: string): { label?: string; width?: string } {
  const parts = attrs.split(/\s+/).filter(Boolean);
  const parsed: { label?: string; width?: string } = {};
  for (const part of parts) {
    if (part.startsWith("#")) {
      parsed.label = part.slice(1);
      continue;
    }
    if (part.startsWith("width=")) {
      parsed.width = part.slice("width=".length);
    }
  }
  return parsed;
}

export function blockContentMarkdownToTex(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    const figureMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)\s]+)\)(?:\{([^}]*)\})?$/);
    if (figureMatch) {
      const caption = figureMatch[1].trim();
      const src = figureMatch[2].trim();
      const attrs = parseFigureAttrs(figureMatch[3] ?? "");
      const width =
        attrs.width && /^(0(\.\d+)?|1(\.0+)?)$/.test(attrs.width) ? attrs.width : "0.8";
      out.push("\\begin{figure}[htbp]");
      out.push("  \\centering");
      out.push(`  \\includegraphics[width=${width}\\linewidth]{${src}}`);
      if (caption) out.push(`  \\caption{${caption}}`);
      if (attrs.label) out.push(`  \\label{${attrs.label}}`);
      out.push("\\end{figure}");
      continue;
    }

    if (trimmed.startsWith("$$")) {
      const body: string[] = [];
      const sameLine = trimmed.endsWith("$$") && trimmed.length > 4;
      if (sameLine) {
        body.push(trimmed.slice(2, -2).trim());
      } else {
        const start = line.slice(line.indexOf("$$") + 2);
        if (start.trim()) body.push(start.trim());
        while (i + 1 < lines.length) {
          i += 1;
          const next = lines[i];
          const endIdx = next.indexOf("$$");
          if (endIdx >= 0) {
            const tail = next.slice(0, endIdx).trim();
            if (tail) body.push(tail);
            break;
          }
          body.push(next);
        }
      }

      out.push("\\begin{equation}");
      out.push(body.join("\n"));
      out.push("\\end{equation}");
      continue;
    }

    out.push(line.replace(/\[@([A-Za-z0-9:_-]+)\]/g, "\\cite{$1}"));
  }

  return out.join("\n");
}

export function buildTexDocument(blocks: ArticleBlock[], bibliography: BibliographyEntry[]): ExportResult {
  const parts = blocks.map((block) => {
    const level = block.level <= 1 ? 1 : block.level === 2 ? 2 : 3;
    const command = level === 1 ? "\\section" : level === 2 ? "\\subsection" : "\\subsubsection";
    const heading = `${command}{${block.heading}}`;
    const content = block.content.trim();
    if (!content) return heading;
    return `${heading}\n\n${blockContentMarkdownToTex(content)}`;
  });

  if (bibliography.length > 0) {
    const refs = formatBibliographyIEEE(bibliography);
    parts.push("\\begin{thebibliography}{99}");
    bibliography.forEach((entry, idx) => {
      parts.push(`\\bibitem{${entry.key}} ${refs[idx].replace(/^\[\d+\]\s*/, "")}`);
    });
    parts.push("\\end{thebibliography}");
  }

  return {
    content: parts.join("\n\n").trim(),
    warnings: [],
  };
}

export function blockContentTexToMarkdown(text: string): string {
  return text
    .replace(/\\cite\{([^}]+)\}/g, "[@$1]")
    .replace(
      /\\begin\{equation\}([\s\S]*?)\\end\{equation\}/g,
      (_m, expr: string) => `$$\n${expr.trim()}\n$$`,
    );
}

export function buildMarkdownDocument(
  blocks: ArticleBlock[],
  bibliography: BibliographyEntry[],
): ExportResult {
  const body = blocks
    .map((block) => {
      const level = Math.max(1, Math.min(3, block.level));
      const heading = `${"#".repeat(level)} ${block.heading}`;
      const content = block.content.trim();
      return content ? `${heading}\n\n${blockContentTexToMarkdown(content)}` : heading;
    })
    .join("\n\n")
    .trim();

  if (bibliography.length === 0) {
    return { content: body, warnings: [] };
  }

  const refs = formatBibliographyIEEE(bibliography);
  return {
    content: `${body}\n\n## References\n\n${refs.join("\n")}`.trim(),
    warnings: [],
  };
}

export function exportSource(
  sourceText: string,
  sourceFormat: SourceFormat,
  target: "md" | "tex",
  bibliography: BibliographyEntry[],
): ExportResult {
  const blocks =
    sourceFormat === "tex"
      ? parseTexToBlocks(sourceText)
      : parseMarkdownToBlocks(sourceText);

  if (target === "md") {
    return buildMarkdownDocument(blocks, bibliography);
  }
  return buildTexDocument(blocks, bibliography);
}
