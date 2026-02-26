import { ImageAlign, ParsedMarkdownImageLine, WorkspaceFile } from "./types";

export function sanitizeFileStem(name: string): string {
  const cleaned = name
    .trim()
    .replace(/\.[^.]+$/, "")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || "image";
}

export function inferImageExtension(name: string, mimeType: string): string {
  const fromName = name.toLowerCase().match(/\.(png|jpe?g|gif|webp|svg)$/);
  if (fromName) return fromName[1] === "jpeg" ? "jpg" : fromName[1];
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("jpeg")) return "jpg";
  if (mimeType.includes("gif")) return "gif";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("svg")) return "svg";
  return "png";
}

export function createUniqueImageFileName(
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

export function isImageFileName(name: string): boolean {
  return /\.(avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(name.trim());
}

export function isInlineImageDataUrl(input: string | null | undefined): boolean {
  if (!input) return false;
  const trimmed = input.trim();
  return /^(?:data|ata):image\/[a-z0-9.+-]+(?:;[a-z0-9.+-]+=[^;,]+|;base64)*,/i.test(trimmed);
}

export function isWorkspaceImageFile(file: Pick<WorkspaceFile, "kind" | "name" | "content">): boolean {
  return file.kind === "file" && (isImageFileName(file.name) || isInlineImageDataUrl(file.content));
}

export function normalizeImageSrcCandidate(input: string): string {
  const trimmed = input.trim();
  if (/^ata:image\//i.test(trimmed)) {
    return `d${trimmed}`;
  }
  return trimmed;
}

export function deriveImagePreviewSource(
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

export function rewriteImagePathReferencesInMarkdown(
  source: string,
  options: {
    movedFileId: string;
    oldPath: string;
    newPath: string;
    documentPath: string | null;
    resolveWorkspacePathFromDocument: (input: string, documentPath: string | null) => string | null;
  },
): string {
  return source.replace(/!\[([^\]]*)\]\(([^)]+)\)(\{[^}]*\})?/g, (_all, alt, rawSrc, attrs) => {
    const src = String(rawSrc).trim();
    const byId = src.match(/^workspace:\/\/(.+)$/)?.[1];
    const resolved = src.startsWith("workspace://") ? null : options.resolveWorkspacePathFromDocument(src, options.documentPath);
    const shouldRewrite = byId === options.movedFileId || resolved === options.oldPath;
    if (!shouldRewrite) return _all;
    return `![${alt}](${options.newPath})${attrs ?? ""}`;
  });
}

export function toFigureLabel(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return `fig:${base || "image"}`;
}

export function parseMarkdownImageLine(text: string): ParsedMarkdownImageLine | null {
  const match = text.trim().match(/^!\[([^\]]*)\]\(([^)\s]+)\)(?:\{([^}]*)\})?$/);
  if (!match) return null;
  return {
    alt: match[1].trim(),
    rawSrc: match[2].trim(),
    attrs: (match[3] ?? "").trim(),
  };
}

export function imageAlignFromAttrs(attrs: string): ImageAlign {
  const match = attrs.match(/\balign=(left|center|right)\b/i);
  if (!match) return "center";
  const value = match[1].toLowerCase();
  return value === "left" || value === "right" ? value : "center";
}

export function setImageAlignOnMarkdownLine(text: string, align: ImageAlign): string {
  const parsed = parseMarkdownImageLine(text);
  if (!parsed) return text;
  const tokens = parsed.attrs.length > 0 ? parsed.attrs.split(/\s+/).filter(Boolean) : [];
  const kept = tokens.filter((token) => !/^align=(left|center|right)$/i.test(token));
  kept.push(`align=${align}`);
  const attrs = kept.length > 0 ? `{${kept.join(" ")}}` : "";
  return `![${parsed.alt}](${parsed.rawSrc})${attrs}`;
}
