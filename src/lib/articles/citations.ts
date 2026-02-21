import type { ArticleBlock } from "@/lib/articles/blocks";

export interface BibliographyEntry {
  key: string;
  rawBibtex: string;
  title?: string;
  author?: string;
  year?: string;
}

const MAX_BIB_ENTRIES = 500;
const CITATION_KEY_REGEX = /\[@([A-Za-z0-9:_-]+)\]/g;

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function cleanupFieldValue(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/^\{+/, "")
    .replace(/\}+$/, "")
    .replace(/^"+/, "")
    .replace(/"+$/, "")
    .trim();
}

function readField(raw: string, fieldName: string): string | undefined {
  const regex = new RegExp(`${fieldName}\\s*=\\s*(\\{[^]*?\\}|\"[^]*?\")`, "i");
  const match = raw.match(regex);
  if (!match) return undefined;
  const cleaned = cleanupFieldValue(match[1]);
  return cleaned || undefined;
}

function parseRawBibtexEntry(rawBibtex: string, key: string): BibliographyEntry {
  const title = readField(rawBibtex, "title");
  const author = readField(rawBibtex, "author");
  const year = readField(rawBibtex, "year");
  return { key, rawBibtex: rawBibtex.trim(), title, author, year };
}

function parseAuthorList(authorField: string | undefined): string[] {
  if (!authorField) return [];
  return authorField
    .split(/\s+and\s+/i)
    .map((author) => cleanupFieldValue(author))
    .filter(Boolean);
}

function formatAuthorsForReference(authorField: string | undefined): string {
  const authors = parseAuthorList(authorField);
  if (authors.length === 0) return "Unknown author";
  if (authors.length >= 3) return `${authors[0]} et al.`;
  if (authors.length === 2) return `${authors[0]} and ${authors[1]}`;
  return authors[0];
}

export function normalizeBibliography(input: unknown): BibliographyEntry[] {
  if (!Array.isArray(input)) return [];

  const result: BibliographyEntry[] = [];
  const seen = new Set<string>();

  for (const item of input) {
    if (typeof item !== "object" || item === null) continue;
    const maybeKey = asString((item as { key?: unknown }).key)?.trim();
    const maybeRawBibtex = asString((item as { rawBibtex?: unknown }).rawBibtex)?.trim();
    if (!maybeKey || !maybeRawBibtex) continue;
    if (seen.has(maybeKey)) continue;

    seen.add(maybeKey);
    result.push(parseRawBibtexEntry(maybeRawBibtex, maybeKey));
    if (result.length >= MAX_BIB_ENTRIES) break;
  }

  return result;
}

export function compactBibliography(entries: BibliographyEntry[]): BibliographyEntry[] {
  const result: BibliographyEntry[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const key = entry.key?.trim();
    const rawBibtex = entry.rawBibtex?.trim();
    if (!key || !rawBibtex) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ key, rawBibtex });
    if (result.length >= MAX_BIB_ENTRIES) break;
  }

  return result;
}

export function serializeBibliography(entries: BibliographyEntry[]): string {
  return JSON.stringify(compactBibliography(entries));
}

export function deserializeBibliography(raw: string): BibliographyEntry[] {
  try {
    return normalizeBibliography(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

export function extractCitationKeysFromText(text: string): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  CITATION_KEY_REGEX.lastIndex = 0;
  for (;;) {
    const match = CITATION_KEY_REGEX.exec(text);
    if (!match) break;
    const key = match[1];
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

export function extractCitationKeysFromBlocks(blocks: ArticleBlock[]): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const block of blocks) {
    const combined = `${block.heading}\n${block.content}`;
    const inBlock = extractCitationKeysFromText(combined);
    for (const key of inBlock) {
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

export function parseBibtexEntries(raw: string): BibliographyEntry[] {
  const entries: BibliographyEntry[] = [];
  const seen = new Set<string>();
  let cursor = 0;

  while (cursor < raw.length) {
    const at = raw.indexOf("@", cursor);
    if (at === -1) break;

    const header = raw.slice(at).match(/^@([A-Za-z]+)\s*([{(])/);
    if (!header) {
      cursor = at + 1;
      continue;
    }

    const open = header[2];
    const close = open === "{" ? "}" : ")";
    const payloadStart = at + header[0].length;
    const keyEnd = raw.indexOf(",", payloadStart);
    if (keyEnd === -1) {
      cursor = payloadStart;
      continue;
    }

    const key = raw.slice(payloadStart, keyEnd).trim();
    if (!key) {
      cursor = keyEnd + 1;
      continue;
    }

    let depth = 1;
    let idx = keyEnd + 1;
    while (idx < raw.length && depth > 0) {
      const ch = raw[idx];
      if (ch === open) depth += 1;
      if (ch === close) depth -= 1;
      idx += 1;
    }

    if (depth !== 0) {
      cursor = keyEnd + 1;
      continue;
    }

    const rawBibtex = raw.slice(at, idx).trim();
    if (!seen.has(key)) {
      seen.add(key);
      entries.push(parseRawBibtexEntry(rawBibtex, key));
      if (entries.length >= MAX_BIB_ENTRIES) break;
    }

    cursor = idx;
  }

  return entries;
}

function firstAuthorSurname(authorField: string | undefined): string | null {
  const first = parseAuthorList(authorField)[0];
  if (!first) return null;
  if (first.includes(",")) {
    const [last] = first.split(",");
    return last.trim() || null;
  }
  const parts = first.split(/\s+/);
  return parts.length > 0 ? parts[parts.length - 1] : null;
}

export function formatCitationChip(entry: BibliographyEntry): string {
  const surname = firstAuthorSurname(entry.author);
  if (surname && entry.year) return `${surname}, ${entry.year}`;
  if (entry.year) return `${entry.key}, ${entry.year}`;
  return entry.key;
}

export function formatBibliographyIEEE(entries: BibliographyEntry[]): string[] {
  return entries.map((entry, index) => {
    const author = formatAuthorsForReference(entry.author);
    const title = entry.title ? `"${entry.title}"` : `"${entry.key}"`;
    const year = entry.year ?? "n.d.";
    return `[${index + 1}] ${author}, ${title}, ${year}.`;
  });
}
