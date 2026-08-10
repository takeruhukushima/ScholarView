/*
 * CSL-JSON <-> bibliography helpers.
 *
 * `pub.paper.reference` records store bibliographic data as CSL-JSON (the
 * canonical form, authored directly in the editor). This module converts a
 * CSL reference to a BibTeX entry so a `.bib` file can be regenerated on any
 * device. Generated BibTeX carries a lossless ScholarView payload, while
 * hand-authored BibTeX is imported through a conservative common-field map.
 */

import type { BibliographyEntry } from "@/lib/articles/citations";
import { formatBibtexSource } from "@/lib/articles/citations";

/** A single contributor as stored on a `pub.paper.reference` record. */
export interface CslContributor {
  role?: string;
  literal?: string;
  family?: string;
  given?: string;
  sequence?: number;
}

/** The bibliographic payload of a `pub.paper.reference` record (CSL-JSON). */
export interface CslReference {
  type: string;
  title: string;
  containerTitle?: string;
  issued?: { year?: number };
  contributors?: CslContributor[];
  doi?: string;
  arxivId?: string;
  url?: string;
}

export interface AuthoredCslReference {
  reference: CslReference;
  citationKey?: string;
}

/** Parse a code-authored CSL document: one object, an array, or {references:[...]}. */
export function parseCslReferenceDocument(source: string): AuthoredCslReference[] {
  if (!source.trim()) return [];
  const decoded = JSON.parse(source) as unknown;
  const candidates = Array.isArray(decoded)
    ? decoded
    : decoded && typeof decoded === "object" && Array.isArray((decoded as { references?: unknown }).references)
      ? (decoded as { references: unknown[] }).references
      : [decoded];
  return candidates.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object") {
      throw new Error(`references[${index}] must be an object`);
    }
    const value = candidate as Record<string, unknown>;
    if (typeof value.type !== "string" || !value.type.trim()) {
      throw new Error(`references[${index}].type is required`);
    }
    if (typeof value.title !== "string" || !value.title.trim()) {
      throw new Error(`references[${index}].title is required`);
    }
    const citationKey = [value.id, value.citationKey, value["citation-key"]]
      .find((item) => typeof item === "string" && item.trim());
    const reference: CslReference = {
      type: value.type,
      title: value.title,
      ...(typeof value.containerTitle === "string" ? { containerTitle: value.containerTitle } : {}),
      ...(value.issued && typeof value.issued === "object"
        ? { issued: value.issued as CslReference["issued"] }
        : {}),
      ...(Array.isArray(value.contributors)
        ? { contributors: value.contributors as CslReference["contributors"] }
        : {}),
      ...(typeof value.doi === "string" ? { doi: value.doi } : {}),
      ...(typeof value.arxivId === "string" ? { arxivId: value.arxivId } : {}),
      ...(typeof value.url === "string" ? { url: value.url } : {}),
    };
    return {
      reference,
      ...(typeof citationKey === "string" ? { citationKey: citationKey.trim() } : {}),
    };
  });
}

/** Map a CSL `type` to the closest BibTeX entry type. */
export function cslTypeToBibtexType(cslType: string | undefined): string {
  switch ((cslType ?? "").trim()) {
    case "article-journal":
      return "article";
    case "paper-conference":
      return "inproceedings";
    case "chapter":
      return "incollection";
    case "book":
      return "book";
    case "thesis":
      return "phdthesis";
    case "report":
      return "techreport";
    case "manuscript":
      return "unpublished";
    case "preprint":
    case "dataset":
    case "software":
    case "webpage":
    default:
      return "misc";
  }
}

function contributorDisplay(contributor: CslContributor): string | null {
  const family = contributor.family?.trim();
  const given = contributor.given?.trim();
  if (family) {
    return given ? `${family}, ${given}` : family;
  }
  const literal = contributor.literal?.trim();
  return literal || null;
}

function sortedContributors(contributors: CslContributor[] | undefined): CslContributor[] {
  if (!contributors || contributors.length === 0) return [];
  return [...contributors].sort((a, b) => {
    const sa = typeof a.sequence === "number" ? a.sequence : Number.MAX_SAFE_INTEGER;
    const sb = typeof b.sequence === "number" ? b.sequence : Number.MAX_SAFE_INTEGER;
    return sa - sb;
  });
}

/** Contributors, formatted as a BibTeX `author` field ("Family, Given and ..."). */
export function formatContributorsBibtex(contributors: CslContributor[] | undefined): string {
  const names = sortedContributors(contributors)
    .filter((c) => (c.role ?? "author") !== "editor")
    .map(contributorDisplay)
    .filter((v): v is string => Boolean(v));
  return names.join(" and ");
}

function surnameOf(contributor: CslContributor | undefined): string | null {
  if (!contributor) return null;
  const family = contributor.family?.trim();
  if (family) return family;
  const literal = contributor.literal?.trim();
  if (!literal) return null;
  if (literal.includes(",")) {
    const [last] = literal.split(",");
    return last.trim() || null;
  }
  const parts = literal.split(/\s+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : null;
}

/**
 * Derive a deterministic BibTeX citation key from a CSL reference
 * (e.g. "vaswani2017"). Not guaranteed unique — use {@link deriveUniqueCitationKeys}
 * to dedupe across a project.
 */
export function deriveCitationKey(ref: CslReference, fallback = "ref"): string {
  const surname = surnameOf(sortedContributors(ref.contributors)[0]);
  const year = ref.issued?.year;
  let base = (surname ?? "").replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  if (year != null) base += String(year);
  if (!base) {
    base = (ref.title ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 12).toLowerCase();
  }
  return base || fallback;
}

/** Assign a unique, stable-order citation key to each reference. */
export function deriveUniqueCitationKeys(refs: CslReference[]): string[] {
  const used = new Set<string>();
  return refs.map((ref, index) => {
    const base = deriveCitationKey(ref, `ref${index + 1}`);
    if (!used.has(base)) {
      used.add(base);
      return base;
    }
    // Append a, b, c ... then numeric suffixes if exhausted.
    for (let i = 0; i < 26; i += 1) {
      const candidate = `${base}${String.fromCharCode(97 + i)}`;
      if (!used.has(candidate)) {
        used.add(candidate);
        return candidate;
      }
    }
    let n = 2;
    while (used.has(`${base}-${n}`)) n += 1;
    const candidate = `${base}-${n}`;
    used.add(candidate);
    return candidate;
  });
}

function sanitizeBibtexValue(value: string): string {
  // Wrap values in braces at call sites; here we only neutralise characters
  // that would unbalance the braces or break a field.
  return value.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

/** Convert one CSL reference to a BibTeX entry with the given citation key. */
export function cslToBibtex(ref: CslReference, key: string): string {
  const bibType = cslTypeToBibtexType(ref.type);
  const fields: Array<[string, string]> = [];

  const author = formatContributorsBibtex(ref.contributors);
  if (author) fields.push(["author", author]);

  if (ref.title?.trim()) fields.push(["title", ref.title.trim()]);

  const container = ref.containerTitle?.trim();
  if (container) {
    const fieldName =
      bibType === "inproceedings" || bibType === "incollection" ? "booktitle" : "journal";
    fields.push([fieldName, container]);
  }

  if (ref.issued?.year != null) fields.push(["year", String(ref.issued.year)]);
  if (ref.doi?.trim()) fields.push(["doi", ref.doi.trim()]);

  const url =
    ref.url?.trim() || (ref.arxivId?.trim() ? `https://arxiv.org/abs/${ref.arxivId.trim()}` : "");
  if (url) fields.push(["url", url]);
  if (ref.arxivId?.trim()) fields.push(["eprint", ref.arxivId.trim()]);

  const body = fields
    .map(([name, value]) => `  ${name} = {${sanitizeBibtexValue(value)}}`)
    .join(",\n");

  const entry = body ? `@${bibType}{${key},\n${body}\n}` : `@${bibType}{${key}\n}`;
  return entry;
}

/**
 * BibTeX used as a generated compatibility artifact. The encoded CSL payload
 * is retained in a namespaced custom field, so ScholarView never needs to
 * reverse-parse arbitrary BibTeX into canonical CSL data.
 */
export function cslToScholarBibtex(ref: CslReference, key: string): string {
  const bibtex = cslToBibtex(ref, key);
  const encoded = encodeURIComponent(JSON.stringify(ref));
  return bibtex.replace(/\n}$/, `,\n  scholarviewcsl = {${encoded}}\n}`);
}

function bibtexTypeToCslType(type: string): string {
  switch (type.toLowerCase()) {
    case "article": return "article-journal";
    case "inproceedings":
    case "conference": return "paper-conference";
    case "incollection": return "chapter";
    case "book":
    case "inbook": return "book";
    case "phdthesis":
    case "mastersthesis": return "thesis";
    case "techreport": return "report";
    case "unpublished": return "manuscript";
    default: return "preprint";
  }
}

function unwrapBibtexValue(value: string): string {
  let result = value.trim();
  if ((result.startsWith("{") && result.endsWith("}")) ||
      (result.startsWith('"') && result.endsWith('"'))) {
    result = result.slice(1, -1);
  }
  return result.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

function parseBibtexFields(rawBibtex: string): { type: string; fields: Map<string, string> } | null {
  const header = rawBibtex.match(/^\s*@([A-Za-z]+)\s*[{(]\s*[^,]+,/);
  if (!header) return null;
  const body = rawBibtex.slice(header[0].length, rawBibtex.lastIndexOf(rawBibtex.trimEnd().endsWith(")") ? ")" : "}"));
  const chunks: string[] = [];
  let start = 0;
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === '"' && body[index - 1] !== "\\") quoted = !quoted;
    if (quoted) continue;
    if (char === "{") depth += 1;
    else if (char === "}") depth = Math.max(0, depth - 1);
    else if (char === "," && depth === 0) {
      chunks.push(body.slice(start, index));
      start = index + 1;
    }
  }
  chunks.push(body.slice(start));
  const fields = new Map<string, string>();
  for (const chunk of chunks) {
    const equals = chunk.indexOf("=");
    if (equals < 1) continue;
    const name = chunk.slice(0, equals).trim().toLowerCase();
    const value = unwrapBibtexValue(chunk.slice(equals + 1));
    if (name && value) fields.set(name, value);
  }
  return { type: header[1], fields };
}

function contributorsFromBibtex(author: string | undefined): CslContributor[] | undefined {
  if (!author) return undefined;
  const contributors = author.split(/\s+and\s+/i).map((raw, index): CslContributor => {
    const name = raw.trim();
    const comma = name.indexOf(",");
    if (comma >= 0) {
      return {
        role: "author",
        family: name.slice(0, comma).trim(),
        given: name.slice(comma + 1).trim() || undefined,
        sequence: index + 1,
      };
    }
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length > 1) {
      return {
        role: "author",
        family: parts.pop(),
        given: parts.join(" "),
        sequence: index + 1,
      };
    }
    return { role: "author", literal: name, sequence: index + 1 };
  }).filter((contributor) => contributor.family || contributor.literal);
  return contributors.length > 0 ? contributors : undefined;
}

export function cslFromScholarBibtex(rawBibtex: string): CslReference | null {
  const match = rawBibtex.match(/scholarviewcsl\s*=\s*\{([^}]*)\}/i);
  if (match) {
    try {
      const value = JSON.parse(decodeURIComponent(match[1])) as unknown;
      if (!value || typeof value !== "object") return null;
      const record = value as Record<string, unknown>;
      if (typeof record.type !== "string" || typeof record.title !== "string") return null;
      return value as CslReference;
    } catch {
      return null;
    }
  }

  const parsed = parseBibtexFields(rawBibtex);
  const title = parsed?.fields.get("title")?.trim();
  if (!parsed || !title) return null;
  const yearText = parsed.fields.get("year")?.match(/\d{4}/)?.[0];
  const containerTitle = parsed.fields.get("journal") ?? parsed.fields.get("booktitle");
  const arxivId = parsed.fields.get("eprint");
  const contributors = contributorsFromBibtex(parsed.fields.get("author"));
  return {
    type: bibtexTypeToCslType(parsed.type),
    title,
    ...(containerTitle ? { containerTitle } : {}),
    ...(yearText ? { issued: { year: Number(yearText) } } : {}),
    ...(contributors ? { contributors } : {}),
    ...(parsed.fields.get("doi") ? { doi: parsed.fields.get("doi") } : {}),
    ...(arxivId ? { arxivId } : {}),
    ...(parsed.fields.get("url") ? { url: parsed.fields.get("url") } : {}),
  };
}

/** Convert a CSL reference to a {@link BibliographyEntry} (for in-app rendering). */
export function cslToBibliographyEntry(ref: CslReference, key: string): BibliographyEntry {
  return {
    key,
    rawBibtex: cslToBibtex(ref, key),
    title: ref.title?.trim() || undefined,
    author: formatContributorsBibtex(ref.contributors) || undefined,
    year: ref.issued?.year != null ? String(ref.issued.year) : undefined,
    url: ref.url?.trim() || undefined,
  };
}

/**
 * Render a set of CSL references as a formatted `.bib` document. Citation keys
 * are derived and de-duplicated deterministically; the returned `keys` align
 * by index with the input `refs`.
 */
export function referencesToBib(refs: CslReference[]): { bib: string; keys: string[] } {
  const keys = deriveUniqueCitationKeys(refs);
  const source = refs.map((ref, i) => cslToBibtex(ref, keys[i])).join("\n\n");
  return { bib: formatBibtexSource(source), keys };
}
