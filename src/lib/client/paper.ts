/*
 * Data model for the `pub.paper.*` records ScholarView releases per paper
 * project, plus the ScholarView-owned `sci.peer.workspaceProject` that carries
 * the workspace placement so folder structure restores across devices.
 *
 * This module holds the PURE builders/parsers (no IO) so they can be unit
 * tested. The record shapes intentionally mirror Minori's `pub.paper.*` schema
 * (see lexicons/pub.paper.*.json); ScholarView does not extend them — anything
 * ScholarView-specific lives on `sci.peer.workspaceProject`.
 */

import * as pub from "@/lexicons/pub";
import * as sci from "@/lexicons/sci";
import type { CslReference, CslContributor } from "@/lib/articles/csl";
import { hashContent } from "@/lib/workspace/reconcile";

export type StrongRef = { uri: string; cid: string };
export type PaperRepoRecord = { uri: string; cid: string; value: Record<string, unknown> };
export type WorkspaceProjectNode = sci.peer.workspaceProject.Node;
export type WorkspaceProjectBibPlacement = sci.peer.workspaceProject.BibPlacement;

/** A structural snapshot of one paper project, ready to be released. */
export interface ProjectSnapshot {
  /** Collection (project) name — mirrors the project folder name. */
  name: string;
  description?: string;
  purpose?: string;
  targetVenue?: string;
  /** Absolute workspace path of the project root folder. */
  path: string;
  /** Relative subtree (folders/files) inside the project root. */
  nodes: WorkspaceProjectNode[];
  /** Project references (CSL-JSON) to release as pub.paper.reference records. */
  references: CslReference[];
  /** Optional per-reference `.bib` destination (by index into `references`). */
  bibPlacements?: Array<{ referenceIndex: number; bibPath: string }>;
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Snapshot assembly from the workspace tree (pure)
// ---------------------------------------------------------------------------

/** Minimal structural view of a workspace file/folder node. */
export interface WorkspaceFileLike {
  id: string;
  parentId: string | null;
  name: string;
  kind: "folder" | "file";
  sortOrder: number;
  linkedArticleUri?: string | null;
}

function absolutePathOf(byId: Map<string, WorkspaceFileLike>, id: string): string {
  const parts: string[] = [];
  let cursor: string | null = id;
  const guard = new Set<string>();
  while (cursor && !guard.has(cursor)) {
    guard.add(cursor);
    const node = byId.get(cursor);
    if (!node) break;
    parts.unshift(node.name);
    cursor = node.parentId;
  }
  return `/${parts.join("/")}`.replace(/\/{2,}/g, "/");
}

function descendantsOf(
  files: WorkspaceFileLike[],
  rootId: string,
): WorkspaceFileLike[] {
  const childrenByParent = new Map<string | null, WorkspaceFileLike[]>();
  for (const f of files) {
    const list = childrenByParent.get(f.parentId) ?? [];
    list.push(f);
    childrenByParent.set(f.parentId, list);
  }
  const out: WorkspaceFileLike[] = [];
  const stack = [...(childrenByParent.get(rootId) ?? [])];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || seen.has(node.id)) continue;
    seen.add(node.id);
    out.push(node);
    for (const child of childrenByParent.get(node.id) ?? []) stack.push(child);
  }
  return out;
}

/**
 * Assemble a {@link ProjectSnapshot} for the project rooted at `projectRootId`,
 * capturing the project folder's absolute path and its internal subtree (so a
 * new device can restore folders + `.bib`). References are the CSL entries the
 * caller authored for this project. `.bib` file nodes are excluded from `nodes`
 * because they are regenerated from `references` on restore.
 */
export function buildProjectSnapshotFromWorkspace(input: {
  files: WorkspaceFileLike[];
  projectRootId: string;
  references: CslReference[];
  meta?: { description?: string; purpose?: string; targetVenue?: string };
}): ProjectSnapshot | null {
  const byId = new Map(input.files.map((f) => [f.id, f]));
  const root = byId.get(input.projectRootId);
  if (!root || root.kind !== "folder") return null;

  const rootPath = absolutePathOf(byId, root.id);
  const rootPrefix = `${rootPath}/`;

  const nodes: WorkspaceProjectNode[] = descendantsOf(input.files, root.id)
    .filter((f) => !(f.kind === "file" && f.name.toLowerCase().endsWith(".bib")))
    .map((f) => {
      const abs = absolutePathOf(byId, f.id);
      const rel = abs.startsWith(rootPrefix) ? abs.slice(rootPrefix.length) : f.name;
      const node: WorkspaceProjectNode = { path: rel, kind: f.kind, sortOrder: f.sortOrder };
      if (f.linkedArticleUri) node.linkedArticleUri = f.linkedArticleUri;
      return node;
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  return {
    name: root.name,
    path: rootPath,
    nodes,
    references: input.references,
    ...(input.meta?.description ? { description: input.meta.description } : {}),
    ...(input.meta?.purpose ? { purpose: input.meta.purpose } : {}),
    ...(input.meta?.targetVenue ? { targetVenue: input.meta.targetVenue } : {}),
  };
}

// ---------------------------------------------------------------------------
// Builders (produce validated record values ready for createRecord/putRecord)
// ---------------------------------------------------------------------------

export function buildCollectionValue(input: {
  name: string;
  description?: string;
  purpose?: string;
  targetVenue?: string;
  createdAt?: string;
}): pub.paper.collection.Main {
  return pub.paper.collection.main.build({
    name: input.name,
    ...(input.description ? { description: input.description } : {}),
    ...(input.purpose ? { purpose: input.purpose } : {}),
    ...(input.targetVenue ? { targetVenue: input.targetVenue } : {}),
    createdAt: (input.createdAt ?? nowIso()) as pub.paper.collection.Main["createdAt"],
  });
}

function compactContributors(
  contributors: CslContributor[] | undefined,
): CslContributor[] | undefined {
  if (!contributors || contributors.length === 0) return undefined;
  const cleaned = contributors
    .map((c) => {
      const out: CslContributor = {};
      if (c.role) out.role = c.role;
      if (c.literal) out.literal = c.literal;
      if (c.family) out.family = c.family;
      if (c.given) out.given = c.given;
      if (typeof c.sequence === "number") out.sequence = c.sequence;
      return out;
    })
    .filter((c) => c.literal || c.family || c.given);
  return cleaned.length > 0 ? cleaned : undefined;
}

export function buildReferenceValue(
  ref: CslReference,
  createdAt?: string,
): pub.paper.reference.Main {
  const contributors = compactContributors(ref.contributors);
  const year = ref.issued?.year;
  return pub.paper.reference.main.build({
    type: ref.type,
    title: ref.title,
    ...(ref.containerTitle ? { containerTitle: ref.containerTitle } : {}),
    ...(typeof year === "number" ? { issued: { year } } : {}),
    ...(contributors ? { contributors } : {}),
    ...(ref.doi ? { doi: ref.doi } : {}),
    ...(ref.arxivId ? { arxivId: ref.arxivId } : {}),
    ...(ref.url ? { url: ref.url } : {}),
    createdAt: (createdAt ?? nowIso()) as pub.paper.reference.Main["createdAt"],
  });
}

/**
 * Build a `pub.paper.collectionItem` value. Constructed as a plain object (not
 * via `.build()`) so the strongRef CIDs — which come straight from createRecord
 * responses — are not re-validated against the strict `cid` string format.
 */
export function buildCollectionItemValue(input: {
  collection: StrongRef;
  reference: StrongRef;
  addedAt?: string;
}): pub.paper.collectionItem.Main {
  return {
    $type: "pub.paper.collectionItem",
    collection: input.collection,
    reference: input.reference,
    addedAt: (input.addedAt ?? nowIso()) as pub.paper.collectionItem.Main["addedAt"],
  };
}

export function buildWorkspaceProjectValue(input: {
  collectionUri: string;
  path: string;
  nodes?: WorkspaceProjectNode[];
  bibPlacements?: WorkspaceProjectBibPlacement[];
  createdAt?: string;
}): sci.peer.workspaceProject.Main {
  return sci.peer.workspaceProject.main.build({
    collectionUri: input.collectionUri,
    path: input.path,
    ...(input.nodes && input.nodes.length > 0 ? { nodes: input.nodes } : {}),
    ...(input.bibPlacements && input.bibPlacements.length > 0
      ? { bibPlacements: input.bibPlacements }
      : {}),
    createdAt: (input.createdAt ?? nowIso()) as sci.peer.workspaceProject.Main["createdAt"],
  });
}

// ---------------------------------------------------------------------------
// Defensive parsers (read Minori-authored records without strict validation)
// ---------------------------------------------------------------------------

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : undefined;
}

/**
 * Parse a `pub.paper.reference` record value into a {@link CslReference},
 * tolerating richer Minori fields we don't model.
 */
export function cslReferenceFromRecordValue(value: unknown): CslReference | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const type = asString(v.type) ?? "misc";
  const title = asString(v.title);
  if (!title) return null;

  const issuedYear =
    typeof v.issued === "object" && v.issued !== null
      ? asInt((v.issued as Record<string, unknown>).year)
      : undefined;

  let contributors: CslContributor[] | undefined;
  if (Array.isArray(v.contributors)) {
    contributors = v.contributors
      .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
      .map((c) => {
        const out: CslContributor = {};
        const role = asString(c.role);
        const literal = asString(c.literal);
        const family = asString(c.family);
        const given = asString(c.given);
        const sequence = asInt(c.sequence);
        if (role) out.role = role;
        if (literal) out.literal = literal;
        if (family) out.family = family;
        if (given) out.given = given;
        if (typeof sequence === "number") out.sequence = sequence;
        return out;
      })
      .filter((c) => c.literal || c.family || c.given);
  }

  return {
    type,
    title,
    containerTitle: asString(v.containerTitle),
    ...(typeof issuedYear === "number" ? { issued: { year: issuedYear } } : {}),
    ...(contributors && contributors.length > 0 ? { contributors } : {}),
    doi: asString(v.doi),
    arxivId: asString(v.arxivId),
    url: asString(v.url),
  };
}

// ---------------------------------------------------------------------------
// Idempotency helpers
// ---------------------------------------------------------------------------

/**
 * A stable content hash for a project snapshot, used to skip re-releasing
 * unchanged projects. Independent of ordering noise: nodes and references are
 * sorted before hashing.
 */
export function projectSnapshotHash(snapshot: ProjectSnapshot): string {
  const nodes = [...snapshot.nodes]
    .map((n) => `${n.kind}:${n.path}:${n.sortOrder ?? ""}`)
    .sort();
  const refs = snapshot.references
    .map((r) =>
      [
        r.type,
        r.title,
        r.containerTitle ?? "",
        r.issued?.year ?? "",
        (r.contributors ?? [])
          .map((c) => c.literal ?? `${c.family ?? ""},${c.given ?? ""}`)
          .join("|"),
        r.doi ?? "",
        r.arxivId ?? "",
        r.url ?? "",
      ].join(""),
    )
    .sort();
  const payload = JSON.stringify({
    name: snapshot.name,
    description: snapshot.description ?? "",
    purpose: snapshot.purpose ?? "",
    targetVenue: snapshot.targetVenue ?? "",
    path: snapshot.path,
    nodes,
    refs,
  });
  return hashContent(payload);
}

/** Hash of a single reference value (to detect when a reference record needs updating). */
export function referenceHash(ref: CslReference): string {
  return hashContent(
    [
      ref.type,
      ref.title,
      ref.containerTitle ?? "",
      ref.issued?.year ?? "",
      (ref.contributors ?? [])
        .map((c) => `${c.role ?? "author"}:${c.literal ?? `${c.family ?? ""},${c.given ?? ""}`}:${c.sequence ?? ""}`)
        .join("|"),
      ref.doi ?? "",
      ref.arxivId ?? "",
      ref.url ?? "",
    ].join(""),
  );
}

function recordObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function recordString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizedProjectPath(value: unknown): string {
  if (typeof value !== "string") return "";
  const parts = value.replace(/\\/g, "/").split("/").filter((part) => part && part !== ".");
  if (parts.some((part) => part === "..")) return "";
  return parts.length > 0 ? `/${parts.join("/")}` : "";
}

function projectRecordOrder(row: PaperRepoRecord): string {
  const createdAt = recordString(row.value.createdAt);
  return `${createdAt}\u0000${row.uri}`;
}

/** Collapse legacy duplicate workspace records, keeping the newest snapshot per path. */
export function selectLatestWorkspaceProjects(
  projects: PaperRepoRecord[],
): PaperRepoRecord[] {
  const latestByPath = new Map<string, PaperRepoRecord>();
  for (const project of projects) {
    const path = normalizedProjectPath(project.value.path);
    if (!path) continue;
    const current = latestByPath.get(path);
    if (!current || projectRecordOrder(project) > projectRecordOrder(current)) {
      latestByPath.set(path, project);
    }
  }
  return [...latestByPath.values()];
}

/** Select an already-released project by its ScholarView-owned path. */
export function findExistingProjectRecords(input: {
  path: string;
  projects: PaperRepoRecord[];
  collections: PaperRepoRecord[];
}): { project: PaperRepoRecord; collection: PaperRepoRecord } | null {
  const path = normalizedProjectPath(input.path);
  if (!path) return null;
  const project = selectLatestWorkspaceProjects(input.projects).find(
    (row) => normalizedProjectPath(row.value.path) === path,
  );
  if (!project) return null;
  const collectionUri = recordString(project.value.collectionUri);
  const collection = input.collections.find((row) => row.uri === collectionUri);
  return collection ? { project, collection } : null;
}

/** Find a Minori/ScholarView reference already linked to this collection. */
export function findExistingReferenceRecord(input: {
  collectionUri: string;
  hash: string;
  items: PaperRepoRecord[];
  references: PaperRepoRecord[];
}): PaperRepoRecord | null {
  const linkedUris = new Set(
    input.items
      .filter((row) => recordString(recordObject(row.value.collection)?.uri) === input.collectionUri)
      .map((row) => recordString(recordObject(row.value.reference)?.uri))
      .filter(Boolean),
  );
  return input.references.find((row) => {
    if (!linkedUris.has(row.uri)) return false;
    const parsed = cslReferenceFromRecordValue(row.value);
    return parsed ? referenceHash(parsed) === input.hash : false;
  }) ?? null;
}

export function findExistingCollectionItemRecord(input: {
  collectionUri: string;
  referenceUri: string;
  items: PaperRepoRecord[];
}): PaperRepoRecord | null {
  return input.items.find(
    (row) =>
      recordString(recordObject(row.value.collection)?.uri) === input.collectionUri &&
      recordString(recordObject(row.value.reference)?.uri) === input.referenceUri,
  ) ?? null;
}
