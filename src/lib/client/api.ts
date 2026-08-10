"use client";

import { Client } from "@atproto/lex";
import { AtUri } from "@atproto/syntax";

import * as sci from "@/lexicons/sci";
import * as pub from "@/lexicons/pub";
import {
  normalizeBlocks,
  parseMarkdownToBlocks,
  parseTexToBlocks,
  serializeBlocks,
  type ArticleBlock,
} from "@/lib/articles/blocks";
import {
  compactBibliography,
  formatBibtexSource,
  normalizeBibliography,
  serializeBibliography,
} from "@/lib/articles/citations";
import {
  ARTICLE_COLLECTION,
  PAPER_COLLECTION,
  PAPER_COLLECTION_ITEM,
  PAPER_REFERENCE,
  WORKSPACE_PROJECT,
  buildArticleUri,
  buildScholarViewArticleUrl,
  extractQuoteFromExternalUri,
} from "@/lib/articles/uri";
import {
  cslFromScholarBibtex,
  cslToScholarBibtex,
  deriveUniqueCitationKeys,
  type CslReference,
} from "@/lib/articles/csl";
import {
  buildCollectionItemValue,
  buildCollectionValue,
  buildReferenceValue,
  buildWorkspaceProjectValue,
  cslReferenceFromRecordValue,
  findExistingCollectionItemRecord,
  findExistingProjectRecords,
  findExistingReferenceRecord,
  findPublishedProjectRootForNode,
  findStaleProjectReferenceRecords,
  referenceHash,
  selectLatestWorkspaceProjects,
  type StrongRef,
} from "@/lib/client/paper";
import type { BibliographyEntry } from "@/lib/articles/citations";
import {
  getActiveDid,
  getActiveHandle,
  getLexClientForCurrentSession,
  getSessionFetchHandler,
} from "@/lib/auth/browser";
import {
  createWorkspaceFile,
  deletePaperRecordBindingsByUris,
  deleteAnnouncementByUri,
  deleteArticleCascade,
  deleteDraftById,
  deleteWorkspaceFileById,
  getAccountHandle,
  getAnnouncementByArticleUri,
  getArticleByDidAndRkey,
  getArticleOwnerDid,
  getDraftById,
  getInlineCommentsByArticle,
  getRecentArticles,
  getWorkspaceFileById,
  getWorkspaceFileByLinkedArticleUri,
  getWorkspaceFileByPath,
  getPaperRecordBinding,
  listBskyInteractionsBySubjects,
  listDrafts,
  listWorkspaceFiles,
  moveWorkspaceFile,
  saveDraft,
  updateArticleByUri,
  updateWorkspaceFileById,
  upsertAccount,
  upsertArticle,
  upsertArticleAnnouncement,
  upsertBskyInteraction,
  upsertInlineComment,
  upsertPaperRecordBinding,
} from "@/lib/client/store";
import type {
  ArticleAuthor,
  ArticleDetail,
  ArticleImageAsset,
  BskyInteractionAction,
  SourceFormat,
  WorkspaceFileNode,
} from "@/lib/types";
import { resolveWorkspaceImports } from "@/lib/workspace/imports";
import { evaluateSync, hashContent } from "@/lib/workspace/reconcile";

const MAX_TITLE_LENGTH = 300;
const MAX_COMMENT_LENGTH = 2_000;
const MAX_QUOTE_LENGTH = 280;
const MAX_DRAFT_CONTENT_LENGTH = 60_000;
const OWN_ARTICLE_SYNC_INTERVAL_MS = 30_000;

const ownArticleSyncInFlight = new Map<string, Promise<void>>();
const ownArticleSyncedAt = new Map<string, number>();

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function decodeParam(value: string): string {
  return decodeURIComponent(value);
}

function safeTimestampMs(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function sourceFormatFromUnknown(value: unknown): SourceFormat {
  return value === "tex" ? "tex" : "markdown";
}

type UploadedArticleImageAsset = Omit<sci.peer.article.ImageAsset, "$type">;

function normalizeWorkspacePath(path: string): string | null {
  const raw = path.trim().replace(/\\/g, "/");
  if (!raw) return null;

  const segments: string[] = [];
  for (const segment of raw.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  if (segments.length === 0) return null;
  return `/${segments.join("/")}`;
}

function dirname(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash <= 0) return "/";
  return path.slice(0, lastSlash);
}

function buildWorkspaceFilePath(
  file: WorkspaceFileNode,
  allFiles: WorkspaceFileNode[],
): string | null {
  const byId = new Map(allFiles.map((entry) => [entry.id, entry]));
  const segments: string[] = [];

  let current: WorkspaceFileNode | null = file;
  while (current) {
    segments.unshift(current.name);
    if (!current.parentId) break;
    current = byId.get(current.parentId) ?? null;
  }

  if (segments.length === 0) return null;
  return normalizeWorkspacePath(`/${segments.join("/")}`);
}

function collectImageRefsFromMarkdown(text: string): Array<{ src: string; alt: string }> {
  const refs: Array<{ src: string; alt: string }> = [];
  const regex = /!\[([^\]]*)\]\(([^)\s]+)\)(?:\{[^}]*\})?/g;

  for (;;) {
    const match = regex.exec(text);
    if (!match) break;
    const src = match[2]?.trim() ?? "";
    if (!src) continue;
    refs.push({ src, alt: (match[1] ?? "").trim() });
  }

  return refs;
}

function collectImageRefsFromTex(text: string): Array<{ src: string; alt: string }> {
  const refs: Array<{ src: string; alt: string }> = [];
  const regex = /\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/g;

  for (;;) {
    const match = regex.exec(text);
    if (!match) break;
    const src = match[1]?.trim() ?? "";
    if (!src) continue;
    const base = src.split("/").pop() ?? src;
    const alt = base.replace(/\.[A-Za-z0-9]+$/, "");
    refs.push({ src, alt });
  }

  return refs;
}

function collectImageRefsFromBlocks(
  blocks: ArticleBlock[],
  sourceFormat: SourceFormat,
): Array<{ src: string; alt: string }> {
  return blocks.flatMap((block) =>
    sourceFormat === "tex"
      ? collectImageRefsFromTex(block.content)
      : collectImageRefsFromMarkdown(block.content),
  );
}

function resolveImageRefToWorkspacePath(src: string, baseDir: string): string | null {
  const trimmed = src.trim();
  if (!trimmed) return null;
  if (/^(https?:\/\/|data:|blob:|at:)/i.test(trimmed)) return null;
  if (trimmed.startsWith("workspace://")) return null;

  const absolute = trimmed.startsWith("/") ? trimmed : `${baseDir.replace(/\/$/, "")}/${trimmed}`;
  return normalizeWorkspacePath(absolute);
}

function resolveWorkspaceIdRefToPath(
  src: string,
  allFiles: WorkspaceFileNode[],
): string | null {
  const matchedId = src.trim().match(/^workspace:\/\/(.+)$/)?.[1];
  if (!matchedId) return null;

  const file = allFiles.find((item) => item.id === matchedId && item.kind === "file");
  if (!file) return null;
  return buildWorkspaceFilePath(file, allFiles);
}

function decodeDataUrlToBytes(dataUrl: string): { mimeType: string; bytes: Uint8Array } | null {
  const match = dataUrl.match(/^data:([^;,]+)(;base64)?,([\s\S]*)$/i);
  if (!match) return null;

  const mimeType = (match[1] ?? "").trim().toLowerCase();
  if (!mimeType.startsWith("image/")) return null;

  const encoded = match[3] ?? "";
  if (!encoded) return null;

  if (match[2]) {
    try {
      const binary = atob(encoded.replace(/\s+/g, ""));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return { mimeType, bytes };
    } catch {
      return null;
    }
  }

  try {
    const text = decodeURIComponent(encoded);
    return { mimeType, bytes: new TextEncoder().encode(text) };
  } catch {
    return null;
  }
}

async function uploadBlobForCurrentSession(
  lex: Client,
  mimeType: string,
  bytes: Uint8Array,
): Promise<sci.peer.article.ImageAsset["blob"]> {
  const payloadBytes = Uint8Array.from(bytes);
  try {
    const encoding = mimeType as `${string}/${string}`;
    const uploaded = await lex.uploadBlob(new Blob([payloadBytes.buffer], { type: mimeType }), {
      encoding,
    });
    const blob = (uploaded.body as { blob?: unknown }).blob;
    if (!blob) {
      throw new HttpError(500, "Blob upload response is invalid");
    }
    return blob as sci.peer.article.ImageAsset["blob"];
  } catch (error) {
    const err = error as { status?: unknown; error?: unknown; message?: unknown };
    const status = typeof err.status === "number" ? err.status : 400;
    const label = [err.error, err.message].filter((v) => typeof v === "string").join(": ");
    throw new HttpError(
      status,
      `Failed to upload image blob${label ? ` (${label})` : ""}`,
    );
  }
}

async function buildWorkspaceArticleImageAssets(
  lex: Client,
  blocks: ArticleBlock[],
  sourceFormat: SourceFormat,
  ownerDid: string,
  sourceFile: WorkspaceFileNode,
  fallbackAssets: ArticleImageAsset[] = [],
): Promise<UploadedArticleImageAsset[]> {
  const allFiles = await listWorkspaceFiles(ownerDid);
  const sourcePath = buildWorkspaceFilePath(sourceFile, allFiles);
  const baseDir = sourcePath ? dirname(sourcePath) : "/";
  const refs = collectImageRefsFromBlocks(blocks, sourceFormat);
  if (refs.length === 0) return [];

  // Already-published blobs, keyed by normalized path, used to preserve images
  // whose local source file is unavailable on this device (avoids wiping them).
  const fallbackByPath = new Map<string, ArticleImageAsset>();
  for (const asset of fallbackAssets) {
    const key = normalizeWorkspacePath(asset.path) ?? asset.path;
    fallbackByPath.set(key, asset);
  }

  const assetsByPath = new Map<string, UploadedArticleImageAsset>();
  for (const ref of refs) {
    const path =
      resolveWorkspaceIdRefToPath(ref.src, allFiles) ??
      resolveImageRefToWorkspacePath(ref.src, baseDir);
    if (!path || assetsByPath.has(path)) continue;

    const imageFile = await getWorkspaceFileByPath(path, ownerDid);
    const raw =
      imageFile && imageFile.kind === "file" && typeof imageFile.content === "string"
        ? imageFile.content
        : "";
    const decoded = raw ? decodeDataUrlToBytes(raw) : null;

    if (decoded) {
      const blob = await uploadBlobForCurrentSession(lex, decoded.mimeType, decoded.bytes);
      const alt = ref.alt.trim();
      assetsByPath.set(path, alt ? { path, alt, blob } : { path, blob });
      continue;
    }

    // Local source missing: keep the existing published blob for this path so the
    // image survives a re-publish from a device that lacks the raw file.
    const fallback = fallbackByPath.get(normalizeWorkspacePath(path) ?? path);
    if (fallback) {
      const alt = ref.alt.trim() || (fallback.alt ?? "");
      const blob = fallback.blob as unknown as UploadedArticleImageAsset["blob"];
      assetsByPath.set(path, alt ? { path, alt, blob } : { path, blob });
    }
  }

  return [...assetsByPath.values()];
}

export function parseArticleValue(value: unknown): {
  title: string;
  authors: ArticleAuthor[];
  blocks: ArticleBlock[];
  bibliography: ReturnType<typeof normalizeBibliography>;
  images: ArticleImageAsset[];
  createdAt: string;
  sourcePath: string | null;
} | null {
  try {
    const parsed = sci.peer.article.$parse(value);
    const blocks = normalizeBlocks(parsed.blocks);
    if (!parsed.title.trim() || blocks.length === 0) return null;
    return {
      title: parsed.title.trim(),
      authors: (parsed.authors ?? []) as ArticleAuthor[],
      blocks,
      bibliography: normalizeBibliography((parsed as { bibliography?: unknown }).bibliography),
      images: (parsed.images ?? []) as unknown as ArticleImageAsset[],
      createdAt: parsed.createdAt,
      sourcePath: typeof parsed.sourcePath === "string" ? parsed.sourcePath : null,
    };
  } catch {
    const obj = asObject(value);
    if (!obj) return null;

    const title = asString(obj.title).trim();
    const blocks = normalizeBlocks(obj.blocks);
    if (!title || blocks.length === 0) return null;

    const authorsRaw = Array.isArray(obj.authors) ? obj.authors : [];
    const authors: ArticleAuthor[] = authorsRaw.map((a) => {
      const o = asObject(a) || {};
      return {
        name: asString(o.name),
        did: o.did ? asString(o.did) : undefined,
        affiliation: o.affiliation ? asString(o.affiliation) : undefined,
      };
    });

    const imagesRaw = Array.isArray(obj.images) ? obj.images : [];
    const images: ArticleImageAsset[] = imagesRaw.map((img) => {
      const o = asObject(img) || {};
      return {
        path: asString(o.path),
        alt: o.alt ? asString(o.alt) : undefined,
        blob: o.blob as ArticleImageAsset["blob"],
      };
    });

    const createdAtRaw = asString(obj.createdAt);
    return {
      title,
      authors,
      blocks,
      bibliography: normalizeBibliography(obj.bibliography),
      images,
      createdAt: createdAtRaw || new Date().toISOString(),
      sourcePath: obj.sourcePath ? asString(obj.sourcePath) : null,
    };
  }
}

async function syncOwnArticlesFromRepo(options?: { force?: boolean }): Promise<void> {
  const did = await getActiveDid();
  if (!did) return;
  const handle = await getActiveHandle();
  if (handle) {
    await upsertAccount({
      did,
      handle,
      active: 1,
    });
  }

  const now = Date.now();
  const lastSyncedAt = ownArticleSyncedAt.get(did) ?? 0;
  if (!options?.force && now - lastSyncedAt < OWN_ARTICLE_SYNC_INTERVAL_MS) {
    return;
  }

  const inFlight = ownArticleSyncInFlight.get(did);
  if (inFlight) {
    await inFlight;
    return;
  }

  const syncPromise = (async () => {
    const fetchHandler = await getSessionFetchHandler();
    if (!fetchHandler) return;

    let cursor: string | null = null;
    const seenUris = new Set<string>();

    for (let page = 0; page < 20; page += 1) {
      const query = new URLSearchParams({
        repo: did,
        collection: ARTICLE_COLLECTION,
        limit: "100",
        reverse: "true",
      });
      if (cursor) {
        query.set("cursor", cursor);
      }

      const response = await fetchHandler(
        `/xrpc/com.atproto.repo.listRecords?${query.toString()}`,
      );
      if (!response.ok) break;

      const payload = (await response.json()) as {
        records?: unknown;
        cursor?: unknown;
      };
      const records = Array.isArray(payload.records) ? payload.records : [];
      if (records.length === 0) break;

      for (const record of records) {
        const row = asObject(record);
        if (!row) continue;

        const uri = asString(row.uri);
        if (!uri || seenUris.has(uri)) continue;

        let atUri: AtUri;
        try {
          atUri = new AtUri(uri);
        } catch {
          continue;
        }

        if (atUri.collection !== ARTICLE_COLLECTION || atUri.hostname !== did) continue;
        seenUris.add(uri);

        const parsed = parseArticleValue(row.value);
        if (!parsed) continue;

        const indexedAt =
          asString(row.indexedAt) ||
          (safeTimestampMs(parsed.createdAt) ? parsed.createdAt : new Date().toISOString());
        const createdAt = safeTimestampMs(parsed.createdAt)
          ? parsed.createdAt
          : indexedAt || new Date().toISOString();

        await upsertArticle({
          uri,
          authorDid: did,
          title: parsed.title,
          authorsJson: JSON.stringify(parsed.authors),
          blocksJson: serializeBlocks(parsed.blocks),
          bibliographyJson: serializeBibliography(parsed.bibliography),
          imagesJson: JSON.stringify(parsed.images),
          sourceFormat: "markdown",
          broadcasted: 0,
          createdAt,
          indexedAt: indexedAt || createdAt,
          sourcePath: parsed.sourcePath,
        });
      }

      cursor = typeof payload.cursor === "string" ? payload.cursor : null;
      if (!cursor) break;
    }

    ownArticleSyncedAt.set(did, Date.now());
  })();

  ownArticleSyncInFlight.set(did, syncPromise);
  try {
    await syncPromise;
  } finally {
    ownArticleSyncInFlight.delete(did);
  }
}

type RepoRecordRow = { uri: string; cid: string; value: Record<string, unknown> };

async function listOwnRepoRecords(collection: string): Promise<RepoRecordRow[]> {
  const did = await requireDid();
  const fetchHandler = await getSessionFetchHandler();
  if (!fetchHandler) return [];
  const result: RepoRecordRow[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 50; page += 1) {
    const query = new URLSearchParams({ repo: did, collection, limit: "100" });
    if (cursor) query.set("cursor", cursor);
    const response = await fetchHandler(`/xrpc/com.atproto.repo.listRecords?${query}`);
    if (!response.ok) break;
    const payload = (await response.json()) as { records?: unknown; cursor?: unknown };
    const rows = Array.isArray(payload.records) ? payload.records : [];
    for (const raw of rows) {
      const row = asObject(raw);
      const value = asObject(row?.value);
      const uri = asString(row?.uri);
      const cid = asString(row?.cid);
      if (uri && cid && value) result.push({ uri, cid, value });
    }
    cursor = typeof payload.cursor === "string" ? payload.cursor : null;
    if (!cursor || rows.length === 0) break;
  }
  return result;
}

function safeProjectRelativePath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = normalizeWorkspacePath(`/${value}`);
  return normalized?.slice(1) || null;
}

/** Restore project containers and generated bibliography without overwriting local files. */
async function hydratePaperProjects(): Promise<{ created: number }> {
  const did = await requireDid();
  const [projects, collections, items, references] = await Promise.all([
    listOwnRepoRecords(WORKSPACE_PROJECT),
    listOwnRepoRecords(PAPER_COLLECTION),
    listOwnRepoRecords(PAPER_COLLECTION_ITEM),
    listOwnRepoRecords(PAPER_REFERENCE),
  ]);
  const collectionUris = new Set(collections.map((row) => row.uri));
  const refsByUri = new Map<string, CslReference>();
  for (const row of references) {
    const ref = cslReferenceFromRecordValue(row.value);
    if (ref) refsByUri.set(row.uri, ref);
  }
  const refUrisByCollection = new Map<string, string[]>();
  for (const row of items) {
    const collection = asObject(row.value.collection);
    const reference = asObject(row.value.reference);
    const collectionUri = asString(collection?.uri);
    const referenceUri = asString(reference?.uri);
    if (!collectionUri || !referenceUri) continue;
    const values = refUrisByCollection.get(collectionUri) ?? [];
    if (!values.includes(referenceUri)) values.push(referenceUri);
    refUrisByCollection.set(collectionUri, values);
  }

  let created = 0;
  for (const project of selectLatestWorkspaceProjects(projects)) {
    const rootPath = normalizeWorkspacePath(asString(project.value.path));
    const collectionUri = asString(project.value.collectionUri);
    if (!rootPath || !collectionUri || !collectionUris.has(collectionUri)) continue;
    const hydrationKey = bindingKey(did, "workspaceProjectHydration", project.uri);
    const hydration = await getPaperRecordBinding(hydrationKey);
    // A remote snapshot is an import, not an always-on mirror. Once this exact
    // CID has been applied on this device, respect local deletions until a
    // later article publish/update changes the remote project CID.
    if (hydration?.cid === project.cid) continue;

    let projectRoot = await getWorkspaceFileByPath(rootPath, did);
    if (!projectRoot) {
      projectRoot = await ensureWorkspaceFileAtPath(did, rootPath, { kind: "folder" });
      if (projectRoot) created += 1;
    }
    if (!projectRoot || projectRoot.kind !== "folder") continue;
    const rawNodes = Array.isArray(project.value.nodes) ? project.value.nodes : [];
    const nodes = rawNodes
      .map(asObject)
      .filter((node): node is Record<string, unknown> => Boolean(node))
      .sort((a, b) => asString(a.path).split("/").length - asString(b.path).split("/").length);
    for (const node of nodes) {
      const rel = safeProjectRelativePath(node.path);
      if (!rel) continue;
      const fullPath = normalizeWorkspacePath(`${rootPath}/${rel}`);
      if (!fullPath || (await getWorkspaceFileByPath(fullPath, did))) continue;
      // Published article bodies are restored by syncLegacyArticles with content.
      if (asString(node.linkedArticleUri)) continue;
      const kind = asString(node.kind) === "folder" ? "folder" : "file";
      // CSL-JSON is regenerated from pub.paper.reference below, not as an
      // empty placeholder that would block hydration.
      if (kind === "file" && rel.toLowerCase().endsWith(".json")) continue;
      const made = await ensureWorkspaceFileAtPath(did, fullPath, {
        kind,
        ...(kind === "file" ? { content: "", sourceFormat: "markdown" as const } : {}),
      });
      if (made) created += 1;
    }

    const refUris = refUrisByCollection.get(collectionUri) ?? [];
    const placements = Array.isArray(project.value.bibPlacements)
      ? project.value.bibPlacements.map(asObject).filter(Boolean)
      : [];
    const refsByBibPath = new Map<string, Array<{ ref: CslReference; citationKey?: string }>>();
    for (const refUri of refUris) {
      const ref = refsByUri.get(refUri);
      if (!ref) continue;
      const placement = placements.find((p) => asString(p?.referenceUri) === refUri);
      const bibPath = safeProjectRelativePath(placement?.bibPath) ?? "refs.bib";
      const group = refsByBibPath.get(bibPath) ?? [];
      group.push({ ref, citationKey: asString(placement?.citationKey) || undefined });
      refsByBibPath.set(bibPath, group);
    }
    for (const [bibPath, placedRefs] of refsByBibPath) {
      const fullPath = normalizeWorkspacePath(`${rootPath}/${bibPath}`);
      if (!fullPath || (await getWorkspaceFileByPath(fullPath, did))) continue;
      const made = await ensureWorkspaceFileAtPath(did, fullPath, {
        kind: "file",
        content: placedRefs.every((item) => item.citationKey)
          ? formatBibtexSource(
              placedRefs
                .map((item) => cslToScholarBibtex(item.ref, item.citationKey as string))
                .join("\n\n"),
            )
          : (() => {
              const refs = placedRefs.map((item) => item.ref);
              const keys = deriveUniqueCitationKeys(refs);
              return formatBibtexSource(
                refs.map((ref, index) => cslToScholarBibtex(ref, keys[index])).join("\n\n"),
              );
            })(),
        sourceFormat: "markdown",
      });
      if (made) created += 1;
    }

    const jsonNode = nodes.find(
      (node) =>
        asString(node.kind) === "file" &&
        asString(node.path).toLowerCase().endsWith(".json"),
    );
    const jsonPath = safeProjectRelativePath(jsonNode?.path);
    if (jsonPath) {
      const fullPath = normalizeWorkspacePath(`${rootPath}/${jsonPath}`);
      if (fullPath && !(await getWorkspaceFileByPath(fullPath, did))) {
        const authored = refUris.flatMap((refUri) => {
          const ref = refsByUri.get(refUri);
          if (!ref) return [];
          const placement = placements.find((item) => asString(item?.referenceUri) === refUri);
          const citationKey = asString(placement?.citationKey);
          return [{ ...(citationKey ? { id: citationKey } : {}), ...ref }];
        });
        const made = await ensureWorkspaceFileAtPath(did, fullPath, {
          kind: "file",
          content: `${JSON.stringify(authored, null, 2)}\n`,
          sourceFormat: "markdown",
        });
        if (made) created += 1;
      }
    }

    await upsertPaperRecordBinding({
      key: hydrationKey,
      ownerDid: did,
      kind: "workspaceProjectHydration",
      localId: rootPath,
      uri: project.uri,
      cid: project.cid,
      syncedHash: project.cid,
      updatedAt: new Date().toISOString(),
    });
  }
  return { created };
}

function bindingKey(did: string, kind: string, localId: string): string {
  return `${did}:${kind}:${localId}`;
}

async function releasePaperProject(input: {
  did: string;
  lex: Client;
  projectRoot: WorkspaceFileNode;
  files: WorkspaceFileNode[];
  bibliography: BibliographyEntry[];
}): Promise<void> {
  const { did, lex, projectRoot, files } = input;
  const now = new Date().toISOString();
  const projectPath = buildWorkspaceFilePath(projectRoot, files);
  if (!projectPath) return;
  const collectionKey = bindingKey(did, "collection", projectRoot.id);
  const workspaceKey = bindingKey(did, "workspaceProject", projectRoot.id);
  let collectionBinding = await getPaperRecordBinding(collectionKey);
  let workspaceBinding = await getPaperRecordBinding(workspaceKey);
  const collectionValue = buildCollectionValue({ name: projectRoot.name, purpose: "writing", createdAt: now });
  const collectionHash = hashContent(JSON.stringify({ name: projectRoot.name, purpose: "writing" }));
  const [remoteProjects, remoteCollections, remoteItems, remoteReferences] = await Promise.all([
    listOwnRepoRecords(WORKSPACE_PROJECT),
    listOwnRepoRecords(PAPER_COLLECTION),
    listOwnRepoRecords(PAPER_COLLECTION_ITEM),
    listOwnRepoRecords(PAPER_REFERENCE),
  ]);

  // On a new browser the IndexedDB binding table is empty. Adopt the existing
  // project selected by its ScholarView-owned path before creating anything.
  if (!collectionBinding) {
    const existingRecords = findExistingProjectRecords({
      path: projectPath,
      projects: remoteProjects,
      collections: remoteCollections,
    });
    if (existingRecords) {
      const { project: remoteProject, collection: remoteCollection } = existingRecords;
      collectionBinding = {
        key: collectionKey, ownerDid: did, kind: "collection", localId: projectRoot.id,
        uri: remoteCollection.uri, cid: remoteCollection.cid, syncedHash: collectionHash, updatedAt: now,
      };
      workspaceBinding = {
        key: workspaceKey, ownerDid: did, kind: "workspaceProject", localId: projectRoot.id,
        uri: remoteProject.uri, cid: remoteProject.cid, syncedHash: "", updatedAt: now,
      };
      await Promise.all([
        upsertPaperRecordBinding(collectionBinding),
        upsertPaperRecordBinding(workspaceBinding),
      ]);
    }
  }
  if (!collectionBinding) {
    const created = await lex.create(pub.paper.collection.main, collectionValue);
    collectionBinding = {
      key: collectionKey, ownerDid: did, kind: "collection", localId: projectRoot.id,
      uri: created.uri, cid: created.cid, syncedHash: collectionHash, updatedAt: now,
    };
    await upsertPaperRecordBinding(collectionBinding);
  } else {
    if (collectionBinding.syncedHash !== collectionHash) {
      const result = await lex.put(pub.paper.collection.main, collectionValue, {
        rkey: new AtUri(collectionBinding.uri).rkey,
      });
      collectionBinding = { ...collectionBinding, cid: result.cid, syncedHash: collectionHash, updatedAt: now };
      await upsertPaperRecordBinding(collectionBinding);
    }
  }
  const collectionRef: StrongRef = { uri: collectionBinding.uri, cid: collectionBinding.cid };
  const referenceRefs: Array<{ key: string; ref: StrongRef }> = [];
  for (const entry of input.bibliography) {
    const csl = cslFromScholarBibtex(entry.rawBibtex);
    // Existing hand-authored BibTeX remains local/article bibliography data.
    // Only references authored as CSL are released as pub.paper.reference.
    if (!csl) continue;
    const localId = `${projectRoot.id}:${entry.key}`;
    const key = bindingKey(did, "reference", localId);
    let binding = await getPaperRecordBinding(key);
    const value = buildReferenceValue(csl, now);
    const hash = referenceHash(csl);
    if (!binding && remoteReferences.length > 0) {
      const remote = findExistingReferenceRecord({
        collectionUri: collectionRef.uri,
        hash,
        items: remoteItems,
        references: remoteReferences,
      });
      if (remote) {
        binding = { key, ownerDid: did, kind: "reference", localId, uri: remote.uri, cid: remote.cid, syncedHash: hash, updatedAt: now };
        await upsertPaperRecordBinding(binding);
      }
    }
    if (!binding) {
      const created = await lex.create(pub.paper.reference.main, value);
      binding = { key, ownerDid: did, kind: "reference", localId, uri: created.uri, cid: created.cid, syncedHash: hash, updatedAt: now };
      await upsertPaperRecordBinding(binding);
    } else if (binding.syncedHash !== hash) {
      const result = await lex.put(pub.paper.reference.main, value, { rkey: new AtUri(binding.uri).rkey });
      binding = { ...binding, cid: result.cid, syncedHash: hash, updatedAt: now };
      await upsertPaperRecordBinding(binding);
    }
    referenceRefs.push({ key: entry.key, ref: { uri: binding.uri, cid: binding.cid } });

    const edgeLocalId = `${projectRoot.id}:${binding.uri}`;
    const edgeKey = bindingKey(did, "collectionItem", edgeLocalId);
    let edgeBinding = await getPaperRecordBinding(edgeKey);
    const edgeHash = hashContent(`${collectionRef.cid}:${binding.cid}`);
    const edgeValue = buildCollectionItemValue({
      collection: collectionRef,
      reference: { uri: binding.uri, cid: binding.cid },
      addedAt: now,
    });
    if (!edgeBinding && remoteItems.length > 0) {
      const remote = findExistingCollectionItemRecord({
        collectionUri: collectionRef.uri,
        referenceUri: binding.uri,
        items: remoteItems,
      });
      if (remote) {
        edgeBinding = { key: edgeKey, ownerDid: did, kind: "collectionItem", localId: edgeLocalId, uri: remote.uri, cid: remote.cid, syncedHash: edgeHash, updatedAt: now };
        await upsertPaperRecordBinding(edgeBinding);
      }
    }
    if (!edgeBinding) {
      const edge = await lex.create(pub.paper.collectionItem.main, edgeValue);
      edgeBinding = { key: edgeKey, ownerDid: did, kind: "collectionItem", localId: edgeLocalId, uri: edge.uri, cid: edge.cid, syncedHash: edgeHash, updatedAt: now };
      await upsertPaperRecordBinding(edgeBinding);
    } else if (edgeBinding.syncedHash !== edgeHash) {
      const edge = await lex.put(pub.paper.collectionItem.main, edgeValue, {
        rkey: new AtUri(edgeBinding.uri).rkey,
      });
      await upsertPaperRecordBinding({ ...edgeBinding, cid: edge.cid, syncedHash: edgeHash, updatedAt: now });
    }
  }

  const stale = findStaleProjectReferenceRecords({
    collectionUri: collectionRef.uri,
    desiredReferenceUris: referenceRefs.map(({ ref }) => ref.uri),
    items: remoteItems,
  });
  for (const row of stale.items) {
    await lex.delete(pub.paper.collectionItem.main, { rkey: new AtUri(row.uri).rkey });
  }
  for (const uri of stale.orphanReferenceUris) {
    await lex.delete(pub.paper.reference.main, { rkey: new AtUri(uri).rkey });
  }
  await deletePaperRecordBindingsByUris(did, [
    ...stale.items.map((row) => row.uri),
    ...stale.orphanReferenceUris,
  ]);

  const byId = new Map(files.map((file) => [file.id, file]));
  const descendants = files.filter((candidate) => {
    let parentId = candidate.parentId;
    while (parentId) {
      if (parentId === projectRoot.id) return true;
      parentId = byId.get(parentId)?.parentId ?? null;
    }
    return false;
  });
  const nodes = descendants
    .filter((node) => !node.name.toLowerCase().endsWith(".bib"))
    .map((node) => {
      const absolute = buildWorkspaceFilePath(node, files) ?? node.name;
      return {
        path: absolute.startsWith(`${projectPath}/`) ? absolute.slice(projectPath.length + 1) : node.name,
        kind: node.kind,
        sortOrder: node.sortOrder,
        ...(node.linkedArticleUri ? { linkedArticleUri: node.linkedArticleUri } : {}),
      };
    });
  const bibPaths = descendants
    .filter((node) => node.kind === "file" && node.name.toLowerCase().endsWith(".bib"))
    .map((node) => (buildWorkspaceFilePath(node, files) ?? "").slice(projectPath.length + 1))
    .filter(Boolean);
  const defaultBibPath = bibPaths[0] ?? "refs.bib";
  const workspaceValue = buildWorkspaceProjectValue({
    collectionUri: collectionRef.uri,
    path: projectPath,
    nodes,
    bibPlacements: referenceRefs.map(({ key, ref }) => ({
      referenceUri: ref.uri,
      bibPath: defaultBibPath,
      citationKey: key,
    })),
    createdAt: now,
  });
  const workspaceHash = hashContent(JSON.stringify({
    collectionUri: workspaceValue.collectionUri,
    path: workspaceValue.path,
    nodes: workspaceValue.nodes ?? [],
    bibPlacements: workspaceValue.bibPlacements ?? [],
  }));
  if (!workspaceBinding) {
    const created = await lex.create(sci.peer.workspaceProject.main, workspaceValue);
    workspaceBinding = { key: workspaceKey, ownerDid: did, kind: "workspaceProject", localId: projectRoot.id, uri: created.uri, cid: created.cid, syncedHash: workspaceHash, updatedAt: now };
  } else if (workspaceBinding.syncedHash !== workspaceHash) {
    const updated = await lex.put(sci.peer.workspaceProject.main, workspaceValue, { rkey: new AtUri(workspaceBinding.uri).rkey });
    workspaceBinding = { ...workspaceBinding, cid: updated.cid, syncedHash: workspaceHash, updatedAt: now };
  }
  await upsertPaperRecordBinding(workspaceBinding);
  // The publishing browser already has this exact project snapshot locally.
  // Mark it applied so a reload cannot rehydrate files the user later deletes.
  await upsertPaperRecordBinding({
    key: bindingKey(did, "workspaceProjectHydration", workspaceBinding.uri),
    ownerDid: did,
    kind: "workspaceProjectHydration",
    localId: projectPath,
    uri: workspaceBinding.uri,
    cid: workspaceBinding.cid,
    syncedHash: workspaceBinding.cid,
    updatedAt: now,
  });
}

async function deleteReleasedPaperProject(input: {
  did: string;
  lex: Client;
  projectRoot: WorkspaceFileNode;
  files: WorkspaceFileNode[];
}): Promise<void> {
  const projectPath = buildWorkspaceFilePath(input.projectRoot, input.files);
  if (!projectPath) return;
  const [projects, collections, items] = await Promise.all([
    listOwnRepoRecords(WORKSPACE_PROJECT),
    listOwnRepoRecords(PAPER_COLLECTION),
    listOwnRepoRecords(PAPER_COLLECTION_ITEM),
  ]);
  const existing = findExistingProjectRecords({
    path: projectPath,
    projects,
    collections,
  });
  if (!existing) return;

  const deleteIfPresent = async (
    collection: `${string}.${string}.${string}`,
    uri: string,
  ) => {
    try {
      await input.lex.deleteRecord(collection, new AtUri(uri).rkey);
    } catch (error) {
      const detail = error as { error?: unknown; message?: unknown; status?: unknown };
      const label = [detail.error, detail.message]
        .filter((value): value is string => typeof value === "string")
        .join(" ")
        .toLowerCase();
      if (detail.status === 404 || label.includes("not found")) return;
      throw error;
    }
  };

  const collectionUri = existing.collection.uri;
  const stale = findStaleProjectReferenceRecords({
    collectionUri,
    desiredReferenceUris: [],
    items,
  });
  for (const row of stale.items) {
    await deleteIfPresent(PAPER_COLLECTION_ITEM, row.uri);
  }
  for (const uri of stale.orphanReferenceUris) {
    await deleteIfPresent(PAPER_REFERENCE, uri);
  }
  await deleteIfPresent(WORKSPACE_PROJECT, existing.project.uri);
  await deleteIfPresent(PAPER_COLLECTION, existing.collection.uri);
  await deletePaperRecordBindingsByUris(input.did, [
    existing.project.uri,
    existing.collection.uri,
    ...stale.items.map((row) => row.uri),
    ...stale.orphanReferenceUris,
  ]);
}

async function requireDid(): Promise<string> {
  const did = await getActiveDid();
  if (!did) throw new HttpError(401, "Unauthorized");

  const handle = await getActiveHandle();
  if (handle) {
    await upsertAccount({
      did,
      handle,
      active: 1,
    });
  }

  return did;
}

async function getDidOrLocal(): Promise<string> {
  const did = await getActiveDid();
  if (did) {
    const handle = await getActiveHandle();
    if (handle) {
      await upsertAccount({
        did,
        handle,
        active: 1,
      });
    }
    return did;
  }
  return "local";
}

async function getAuthedLexClient(): Promise<{ did: string; lex: Client }> {
  const did = await requireDid();
  const lex = await getLexClientForCurrentSession();
  return { did, lex };
}

function getBlocksFromSource(input: {
  blocks?: unknown;
  sourceFormat: SourceFormat;
  markdown?: unknown;
  tex?: unknown;
  resolvedMarkdown?: unknown;
  resolvedTex?: unknown;
}): ArticleBlock[] {
  if (input.blocks !== undefined) {
    return normalizeBlocks(input.blocks);
  }

  if (input.sourceFormat === "tex") {
    const value =
      typeof input.resolvedTex === "string"
        ? input.resolvedTex
        : typeof input.tex === "string"
          ? input.tex
          : "";
    return value ? parseTexToBlocks(value) : [];
  }

  const value =
    typeof input.resolvedMarkdown === "string"
      ? input.resolvedMarkdown
      : typeof input.markdown === "string"
        ? input.markdown
        : "";
  return value ? parseMarkdownToBlocks(value) : [];
}

async function createArticle(request: Request): Promise<Response> {
  const { did, lex } = await getAuthedLexClient();
  const body = (await request.json()) as {
    title?: unknown;
    authors?: unknown;
    sourceFormat?: unknown;
    broadcastToBsky?: unknown;
    broadcastText?: unknown;
    markdown?: unknown;
    tex?: unknown;
    resolvedMarkdown?: unknown;
    resolvedTex?: unknown;
    blocks?: unknown;
    bibliography?: unknown;
    images?: unknown;
  };
  const customBroadcastText = typeof body.broadcastText === "string" ? body.broadcastText : null;

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) throw new HttpError(400, "Title is required");
  if (title.length > MAX_TITLE_LENGTH) {
    throw new HttpError(400, `Title must be <= ${MAX_TITLE_LENGTH} characters`);
  }

  const authors = Array.isArray(body.authors) ? (body.authors as ArticleAuthor[]) : [];
  const sourceFormat = sourceFormatFromUnknown(body.sourceFormat);
  const blocks = getBlocksFromSource({
    blocks: body.blocks,
    sourceFormat,
    markdown: body.markdown,
    tex: body.tex,
    resolvedMarkdown: body.resolvedMarkdown,
    resolvedTex: body.resolvedTex,
  });
  if (blocks.length === 0) {
    throw new HttpError(
      400,
      "At least one section is required. Provide markdown with headings or blocks.",
    );
  }

  const bibliography = compactBibliography(normalizeBibliography(body.bibliography));
  const images = Array.isArray(body.images) ? (body.images as ArticleImageAsset[]) : [];
  const createdAt = new Date().toISOString();
  const article = await lex.create(sci.peer.article.main, {
    title,
    authors,
    blocks,
    bibliography,
    images: images as unknown as sci.peer.article.ImageAsset[],
    createdAt,
  });

  let announcement: { uri: string; cid: string } | null = null;
  const articleAt = new AtUri(article.uri);
  if (body.broadcastToBsky === true) {
    const atprotoAtUrl = buildScholarViewArticleUrl(did, articleAt.rkey);
    let postText = `新しい論文/実験計画を公開しました：『${title}』 ${atprotoAtUrl}`;
    let embedUri = atprotoAtUrl;

    if (customBroadcastText) {
      postText = customBroadcastText.replace(/\{\{article_url\}\}/g, atprotoAtUrl);
      const urlMatch = postText.match(/https?:\/\/[^\s]+/);
      if (urlMatch) {
        embedUri = urlMatch[0];
      }
    }

    console.log(`[Create] Broadcasting. Text: "${postText}", Embed: ${embedUri}`);

    const post = await lex.createRecord({
      $type: "app.bsky.feed.post",
      text: postText,
      createdAt,
      embed: {
        $type: "app.bsky.embed.external",
        external: {
          uri: embedUri,
          title,
          description: "ScholarViewで論文を公開しました",
        },
      },
    });
    announcement = { uri: post.body.uri, cid: post.body.cid };
  }

  await upsertArticle({
    uri: article.uri,
    authorDid: did,
    title,
    authorsJson: JSON.stringify(authors),
    blocksJson: serializeBlocks(blocks),
    bibliographyJson: serializeBibliography(bibliography),
    imagesJson: JSON.stringify(images),
    sourceFormat,
    broadcasted: announcement ? 1 : 0,
    createdAt,
    indexedAt: createdAt,
  });

  if (announcement) {
    await upsertArticleAnnouncement({
      articleUri: article.uri,
      announcementUri: announcement.uri,
      announcementCid: announcement.cid,
      authorDid: did,
      createdAt,
    });
  }

  return json({
    success: true,
    articleUri: article.uri,
    did,
    rkey: articleAt.rkey,
    ...(announcement
      ? {
          announcementUri: announcement.uri,
          announcementCid: announcement.cid,
        }
      : {}),
  });
}

async function updateArticle(request: Request, did: string, rkey: string): Promise<Response> {
  const { did: sessionDid, lex } = await getAuthedLexClient();
  if (sessionDid !== did) throw new HttpError(403, "Forbidden");

  const body = (await request.json()) as {
    title?: unknown;
    authors?: unknown;
    sourceFormat?: unknown;
    markdown?: unknown;
    tex?: unknown;
    blocks?: unknown;
    broadcastToBsky?: unknown;
    broadcastText?: unknown;
    bibliography?: unknown;
    images?: unknown;
  };
  const customBroadcastText = typeof body.broadcastText === "string" ? body.broadcastText : null;

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) throw new HttpError(400, "Title is required");
  if (title.length > MAX_TITLE_LENGTH) {
    throw new HttpError(400, `Title must be <= ${MAX_TITLE_LENGTH} characters`);
  }

  const authors = Array.isArray(body.authors) ? (body.authors as ArticleAuthor[]) : [];
  const sourceFormat = sourceFormatFromUnknown(body.sourceFormat);
  const blocks = getBlocksFromSource({
    blocks: body.blocks,
    sourceFormat,
    markdown: body.markdown,
    tex: body.tex,
  });
  if (blocks.length === 0) throw new HttpError(400, "At least one section is required");

  const current = await getArticleByDidAndRkey(did, rkey);
  if (!current) throw new HttpError(404, "Article not found");

  const incomingBibliography =
    body.bibliography === undefined ? null : normalizeBibliography(body.bibliography);
  // Keep the stored bibliography when the client omits it or sends an empty set,
  // so an un-hydrated edit cannot silently wipe references.
  const bibliography =
    incomingBibliography && incomingBibliography.length > 0
      ? compactBibliography(incomingBibliography)
      : current.bibliography;
  const compactedBibliography = compactBibliography(bibliography);

  const images =
    body.images === undefined
      ? current.images ?? []
      : (body.images as ArticleImageAsset[]);

  await lex.put(
    sci.peer.article.main,
    {
      title,
      authors,
      blocks,
      bibliography: compactedBibliography,
      images: images as unknown as sci.peer.article.ImageAsset[],
      createdAt: new Date(current.createdAt).toISOString(),
    },
    { rkey },
  );

  const articleUri = buildArticleUri(did, rkey);
  const now = new Date().toISOString();
  const broadcastToBsky = body.broadcastToBsky === true;
  let announcement = await getAnnouncementByArticleUri(articleUri);
  if (!announcement) {
    const discovered = await discoverAnnouncement(did, rkey, fetch);
    if (discovered) {
      await upsertArticleAnnouncement({
        articleUri,
        announcementUri: discovered.uri,
        announcementCid: discovered.cid,
        authorDid: did,
        createdAt: now,
      });
      announcement = {
        articleUri,
        announcementUri: discovered.uri,
        announcementCid: discovered.cid,
        authorDid: did,
        createdAt: now,
      };
    }
  }
  if (announcement) {
    const normalizedRoot =
      (await normalizeAnnouncementRootWithLex(announcement.announcementUri, lex)) ??
      (await normalizeAnnouncementRootWithPublicApi(announcement.announcementUri, fetch));
    if (normalizedRoot && normalizedRoot.uri !== announcement.announcementUri) {
      await upsertArticleAnnouncement({
        articleUri,
        announcementUri: normalizedRoot.uri,
        announcementCid: normalizedRoot.cid,
        authorDid: did,
        createdAt: now,
      });
      announcement = {
        ...announcement,
        announcementUri: normalizedRoot.uri,
        announcementCid: normalizedRoot.cid,
        createdAt: now,
      };
    }
  }
  let announcementUri = announcement?.announcementUri ?? null;
  let broadcasted: 0 | 1 = announcement ? 1 : 0;
  const forceBroadcast = customBroadcastText !== null;
  const shouldAlreadyHaveAnnouncement = current.broadcasted === 1;

  if (broadcastToBsky && (!announcement || forceBroadcast)) {
    if (!announcement && shouldAlreadyHaveAnnouncement) {
      throw new HttpError(
        409,
        "Existing discussion root was not found. Open the discussion once and retry.",
      );
    }

    const atprotoAtUrl = buildScholarViewArticleUrl(did, rkey);
    let postText = `更新した論文を公開しました：『${title}』 ${atprotoAtUrl}`;
    let embedUri = atprotoAtUrl;

    if (customBroadcastText) {
      postText = customBroadcastText.replace(/\{\{article_url\}\}/g, atprotoAtUrl);
      const urlMatch = postText.match(/https?:\/\/[^\s]+/);
      if (urlMatch) {
        embedUri = urlMatch[0];
      }
    }

    console.log(`[Update] Broadcasting. Text: "${postText}", Embed: ${embedUri}`);

    let reply:
      | {
          root: { uri: string; cid: string };
          parent: { uri: string; cid: string };
        }
      | undefined;
    if (announcement) {
      const tail = await findThreadTail(announcement.announcementUri, did, lex);
      reply = {
        root: {
          uri: announcement.announcementUri,
          cid: announcement.announcementCid,
        },
        parent: {
          uri: tail.uri,
          cid: tail.cid,
        },
      };
    }

    const post = await lex.createRecord({
      $type: "app.bsky.feed.post",
      text: postText,
      createdAt: now,
      ...(reply ? { reply } : {}),
      embed: {
        $type: "app.bsky.embed.external",
        external: {
          uri: embedUri,
          title,
          description: "ScholarViewで論文を公開しました",
        },
      },
    });

    if (!announcement) {
      await upsertArticleAnnouncement({
        articleUri,
        announcementUri: post.body.uri,
        announcementCid: post.body.cid,
        authorDid: did,
        createdAt: now,
      });
      announcementUri = post.body.uri;
    } else {
      announcementUri = announcement.announcementUri;
    }
    broadcasted = 1;
  }

  if (!broadcastToBsky && announcement) {
    try {
      const announcementAt = new AtUri(announcement.announcementUri);
      await lex.deleteRecord("app.bsky.feed.post", announcementAt.rkey);
    } catch {
      // Keep local consistency.
    }
    await deleteAnnouncementByUri(announcement.announcementUri);
    announcementUri = null;
    broadcasted = 0;
  }

  await updateArticleByUri(articleUri, {
    title,
    authorsJson: JSON.stringify(authors),
    blocksJson: serializeBlocks(blocks),
    bibliographyJson: serializeBibliography(compactedBibliography),
    imagesJson: JSON.stringify(images),
    sourceFormat,
    indexedAt: now,
    broadcasted,
  });

  return json({
    success: true,
    articleUri,
    announcementUri,
    broadcasted,
  });
}

function transformRecordToArticleDetail(
  did: string,
  rkey: string,
  record: Record<string, unknown>,
): ArticleDetail {
  const uri = buildArticleUri(did, rkey);
  const authors = Array.isArray(record.authors) ? record.authors : [];
  const blocks = Array.isArray(record.blocks) ? record.blocks : [];
  const bibliography = normalizeBibliography(record.bibliography);
  const images = Array.isArray(record.images) ? (record.images as ArticleImageAsset[]) : [];

  return {
    uri,
    did,
    rkey,
    authorDid: did,
    handle: null,
    title: (record.title as string) || "Untitled",
    authors: authors as ArticleAuthor[],
    sourceFormat: (record.sourceFormat as SourceFormat) || "markdown",
    broadcasted: 1,
    createdAt: (record.createdAt as string) || new Date().toISOString(),
    announcementUri: null,
    announcementCid: null,
    blocks: normalizeBlocks(blocks),
    bibliography,
    images,
    sourcePath: typeof record.sourcePath === "string" ? record.sourcePath : null,
  };
}

async function resolvePdsEndpoint(did: string): Promise<string | null> {
  try {
    const res = await fetch(`https://plc.directory/${encodeURIComponent(did)}`, {
      cache: "force-cache",
    });
    if (!res.ok) return null;
    const doc = (await res.json()) as {
      service?: Array<{ id: string; type: string; serviceEndpoint: string }>;
    };
    const pds = doc.service?.find(
      (s) => s.id === "#atproto_pds" || s.type === "AtprotoPersonalDataServer",
    );
    return pds?.serviceEndpoint ?? null;
  } catch {
    return null;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function fetchBlobBytes(
  did: string,
  cid: string,
): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  const query = new URLSearchParams({ did, cid });
  const endpoints: string[] = [];
  const pds = await resolvePdsEndpoint(did);
  if (pds) endpoints.push(pds.replace(/\/$/, ""));
  endpoints.push("https://bsky.social");

  for (const base of endpoints) {
    try {
      const res = await fetch(`${base}/xrpc/com.atproto.sync.getBlob?${query.toString()}`, {
        cache: "force-cache",
      });
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      const mimeType =
        res.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
      return { bytes, mimeType };
    } catch {
      // Try the next endpoint.
    }
  }
  return null;
}

// Fetch a repo blob and encode it as a data URL for local (workspace file) storage.
async function fetchBlobAsDataUrl(
  did: string,
  cid: string,
  mimeTypeHint?: string,
): Promise<string | null> {
  const result = await fetchBlobBytes(did, cid);
  if (!result) return null;
  const mimeType =
    mimeTypeHint && mimeTypeHint.startsWith("image/") ? mimeTypeHint : result.mimeType;
  return `data:${mimeType};base64,${bytesToBase64(result.bytes)}`;
}

// Create a workspace file at an absolute path, materializing any missing parent folders.
// Returns the existing file untouched if one already lives at that path.
async function ensureWorkspaceFileAtPath(
  ownerDid: string,
  rawPath: string,
  file: { kind?: "folder" | "file"; content?: string; sourceFormat?: SourceFormat | null },
): Promise<WorkspaceFileNode | null> {
  const normalized = normalizeWorkspacePath(rawPath);
  if (!normalized) return null;

  const existing = await getWorkspaceFileByPath(normalized, ownerDid);
  if (existing) return existing;

  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  let parentId: string | null = null;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const folderPath = `/${segments.slice(0, i + 1).join("/")}`;
    let folder = await getWorkspaceFileByPath(folderPath, ownerDid);
    if (!folder) {
      folder = await createWorkspaceFile({
        ownerDid,
        parentId,
        name: segments[i],
        kind: "folder",
      });
    }
    if (folder.kind !== "folder") return null;
    parentId = folder.id;
  }

  const leafKind = file.kind ?? "file";
  return createWorkspaceFile({
    ownerDid,
    parentId,
    name: segments[segments.length - 1],
    kind: leafKind,
    sourceFormat: leafKind === "file" ? (file.sourceFormat ?? null) : null,
    content: leafKind === "file" ? (file.content ?? "") : null,
  });
}

// Materialize a published article's images and bibliography as editable local
// workspace files, so the article can be rendered and re-published from any device.
async function hydrateArticleAssets(
  ownerDid: string,
  detail: ArticleDetail,
  bodyFile: WorkspaceFileNode,
): Promise<void> {
  for (const asset of detail.images ?? []) {
    const path = normalizeWorkspacePath(asset.path);
    if (!path) continue;
    if (await getWorkspaceFileByPath(path, ownerDid)) continue;

    const ref = asset.blob?.ref as { $link?: string } | string | undefined;
    const cid = typeof ref === "string" ? ref : ref?.$link;
    if (!cid) continue;

    const dataUrl = await fetchBlobAsDataUrl(ownerDid, cid, asset.blob?.mimeType);
    if (!dataUrl) continue;
    await ensureWorkspaceFileAtPath(ownerDid, path, { content: dataUrl });
  }

  const entries = detail.bibliography ?? [];
  if (entries.length > 0) {
    const allFiles = await listWorkspaceFiles(ownerDid);
    const bodyPath = buildWorkspaceFilePath(bodyFile, allFiles) ?? "/";
    const bibDir = dirname(bodyPath);
    const stem = sanitizeBaseName(detail.title || "references");
    const bibPath = normalizeWorkspacePath(`${bibDir}/${stem}.bib`);
    if (bibPath && !(await getWorkspaceFileByPath(bibPath, ownerDid))) {
      const content = entries
        .map((entry) => entry.rawBibtex)
        .filter((raw) => typeof raw === "string" && raw.trim())
        .join("\n\n");
      if (content.trim()) {
        await ensureWorkspaceFileAtPath(ownerDid, bibPath, {
          content,
          sourceFormat: "markdown",
        });
      }
    }
  }
}

async function resolveCidViaPublicApi(
  uri: string,
  originalFetch: typeof fetch,
): Promise<string> {
  try {
    const atUri = new AtUri(uri);
    const query = new URLSearchParams({
      repo: atUri.hostname,
      collection: atUri.collection,
      rkey: atUri.rkey,
    });
    const response = await originalFetch(
      `https://public.api.bsky.app/xrpc/com.atproto.repo.getRecord?${query.toString()}`,
      { cache: "no-store" },
    );
    if (!response.ok) return "";
    const payload = (await response.json()) as { cid?: unknown };
    return asString(payload.cid);
  } catch {
    return "";
  }
}

async function normalizeAnnouncementRootWithPublicApi(
  announcementUri: string,
  originalFetch: typeof fetch,
): Promise<{ uri: string; cid: string } | null> {
  try {
    const atUri = new AtUri(announcementUri);
    const query = new URLSearchParams({
      repo: atUri.hostname,
      collection: atUri.collection,
      rkey: atUri.rkey,
    });
    const response = await originalFetch(
      `https://public.api.bsky.app/xrpc/com.atproto.repo.getRecord?${query.toString()}`,
      { cache: "no-store" },
    );
    if (!response.ok) return null;

    const payload = (await response.json()) as { value?: unknown };
    const value = asObject(payload.value);
    const reply = asObject(value?.reply);
    const root = asObject(reply?.root);
    const rootUri = asString(root?.uri);
    if (!rootUri) return null;

    let rootCid = asString(root?.cid);
    if (!rootCid) {
      rootCid = await resolveCidViaPublicApi(rootUri, originalFetch);
    }
    if (!rootCid) return null;
    return { uri: rootUri, cid: rootCid };
  } catch {
    return null;
  }
}

async function normalizeAnnouncementRootWithLex(
  announcementUri: string,
  lex: Client,
): Promise<{ uri: string; cid: string } | null> {
  try {
    const atUri = new AtUri(announcementUri);
    const query = new URLSearchParams({
      repo: atUri.hostname,
      collection: atUri.collection,
      rkey: atUri.rkey,
    });
    const response = await lex.fetchHandler(
      `/xrpc/com.atproto.repo.getRecord?${query.toString()}`,
      { method: "GET" },
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as { value?: unknown };
    const value = asObject(payload.value);
    const reply = asObject(value?.reply);
    const root = asObject(reply?.root);
    const rootUri = asString(root?.uri);
    if (!rootUri) return null;

    const rootCid = asString(root?.cid) || (await resolveCid(rootUri));
    if (!rootCid) return null;
    return { uri: rootUri, cid: rootCid };
  } catch {
    return null;
  }
}

async function discoverAnnouncement(
  did: string,
  rkey: string,
  originalFetch: typeof fetch,
): Promise<{ uri: string; cid: string } | null> {
  const articleUrl = buildScholarViewArticleUrl(did, rkey);
  try {
    const matches: Array<{
      uri: string;
      cid: string;
      createdAt: string;
      isReply: boolean;
      rootUri: string | null;
      rootCid: string | null;
    }> = [];
    const MAX_PAGES = 20;
    let cursor = "";

    // Pre-calculate encoded DID and path suffix for faster matching
    const encodedDid = encodeURIComponent(did);
    const pathSuffix = `/article/${did}/${rkey}`;
    const encodedPathSuffix = `/article/${encodedDid}/${rkey}`;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const query = new URLSearchParams({
        actor: did,
        limit: "100",
      });
      if (cursor) {
        query.set("cursor", cursor);
      }

      const res = await originalFetch(
        `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?${query.toString()}`,
        { cache: "no-store" },
      );
      if (!res.ok) return null;

      const payload = (await res.json()) as { feed?: unknown[]; cursor?: unknown };
      const feed = Array.isArray(payload.feed) ? payload.feed : [];

      for (const item of feed) {
        const itemObj = asObject(item);
        const post = asObject(itemObj?.post);
        if (!post) continue;

        const record = asObject(post.record);
        const embed = asObject(post.embed) || asObject(record?.embed);

        if (
          !embed ||
          (embed["$type"] !== "app.bsky.embed.external" &&
            embed["$type"] !== "app.bsky.embed.external#view" &&
            embed["$type"] !== "app.bsky.embed.external#main")
        ) {
          continue;
        }

        const external = asObject(embed.external);
        const externalUri = asString(external?.uri);
        if (!externalUri) continue;

        let isMatch = false;
        if (
          externalUri === articleUrl ||
          externalUri.split("?")[0] === articleUrl.split("?")[0] ||
          externalUri.includes(pathSuffix) ||
          externalUri.includes(encodedPathSuffix)
        ) {
          isMatch = true;
        } else {
          try {
            const candidateUrl = new URL(externalUri);
            const pathParts = candidateUrl.pathname.split("/").filter(Boolean);
            if (pathParts.length >= 3 && pathParts[0] === "article") {
              const candidateId = decodeURIComponent(pathParts[1]);
              const candidateRkey = decodeURIComponent(pathParts[2]);
              if (candidateRkey === rkey) {
                if (candidateId === did) {
                  isMatch = true;
                } else if (!candidateId.startsWith("did:")) {
                  // If it's a handle, we should ideally resolve it, but for performance 
                  // and since getAuthorFeed is already filtered by did, 
                  // a rkey match on the same actor's feed is extremely likely to be it.
                  isMatch = true;
                }
              }
            }
          } catch {
            // ignore
          }
        }

        if (!isMatch) continue;

        const reply = asObject(record?.reply);
        const root = asObject(reply?.root);
        const rootUri = asString(root?.uri);
        const rootCid = asString(root?.cid);
        matches.push({
          uri: asString(post.uri),
          cid: asString(post.cid),
          createdAt:
            asString(record?.createdAt) || asString(post.indexedAt) || new Date().toISOString(),
          isReply: Boolean(reply),
          rootUri: rootUri || null,
          rootCid: rootCid || null,
        });
      }

      const nextCursor = asString(payload.cursor);
      if (!nextCursor) break;
      cursor = nextCursor;
    }

    if (matches.length === 0) return null;

    const roots = matches.filter((m) => !m.isReply);
    const pool = roots.length > 0 ? roots : matches;

    pool.sort((a, b) => {
      const ams = safeTimestampMs(a.createdAt) ?? 0;
      const bms = safeTimestampMs(b.createdAt) ?? 0;
      return ams - bms;
    });
    const selected = pool[0];
    const selectedUri = selected.isReply && selected.rootUri ? selected.rootUri : selected.uri;
    let selectedCid = selected.isReply ? selected.rootCid ?? "" : selected.cid;

    if (!selectedCid) {
      selectedCid = await resolveCidViaPublicApi(selectedUri, originalFetch);
    }
    if (!selectedUri || !selectedCid) return null;

    return { uri: selectedUri, cid: selectedCid };
  } catch (err) {
    console.error("Announcement discovery failed:", err);
  }
  return null;
}

async function getArticle(did: string, rkey: string, originalFetch: typeof fetch): Promise<Response> {
  let article = await getArticleByDidAndRkey(did, rkey);
  if (!article) {
    const currentDid = await getActiveDid();
    if (currentDid && currentDid === did) {
      try {
        await syncOwnArticlesFromRepo({ force: true });
      } catch {
        // Continue with local cache fallback.
      }
      article = await getArticleByDidAndRkey(did, rkey);
    }
  }

  // Fallback 1: Public AT Protocol Relay
  if (!article) {
    try {
      const query = new URLSearchParams({
        repo: did,
        collection: ARTICLE_COLLECTION,
        rkey,
      });
      const res = await fetch(
        `https://public.api.bsky.app/xrpc/com.atproto.repo.getRecord?${query.toString()}`,
        { cache: "no-store" },
      );
      if (res.ok) {
        const payload = (await res.json()) as { value?: Record<string, unknown>; uri?: string };
        if (payload.value) {
          article = transformRecordToArticleDetail(did, rkey, payload.value);
        }
      }
    } catch (err) {
      console.error("Failed to fetch article from public relay:", err);
    }
  }

  // Fallback 2: Direct PDS fetch (Useful when the relay hasn't indexed the collection yet)
  if (!article) {
    try {
      const pdsEndpoint = await resolvePdsEndpoint(did);
      if (pdsEndpoint) {
        const query = new URLSearchParams({
          repo: did,
          collection: ARTICLE_COLLECTION,
          rkey,
        });
        const res = await fetch(
          `${pdsEndpoint.replace(/\/$/, "")}/xrpc/com.atproto.repo.getRecord?${query.toString()}`,
          { cache: "no-store" },
        );
        if (res.ok) {
          const payload = (await res.json()) as { value?: Record<string, unknown>; uri?: string };
          if (payload.value) {
            article = transformRecordToArticleDetail(did, rkey, payload.value);
          }
        }
      }
    } catch (err) {
      console.error("Failed to fetch article directly from PDS:", err);
    }
  }

  if (!article) throw new HttpError(404, "Article not found");

  // Discovery: Try to find announcement if it's missing (common for guest views)
  if (!article.announcementUri) {
    const discovered = await discoverAnnouncement(did, rkey, originalFetch);
    if (discovered) {
      article.announcementUri = discovered.uri;
      article.announcementCid = discovered.cid;
      // Persist locally for future fast lookups
      await upsertArticleAnnouncement({
        articleUri: article.uri,
        announcementUri: discovered.uri,
        announcementCid: discovered.cid,
        authorDid: did,
        createdAt: new Date().toISOString(),
      });
    }
  }

  return json({ success: true, article });
}

async function deleteArticle(
  did: string,
  rkey: string,
  options: { deleteAnnouncement?: boolean } = {},
): Promise<Response> {
  const { did: sessionDid, lex } = await getAuthedLexClient();
  const articleUri = buildArticleUri(did, rkey);
  const ownerDid = await getArticleOwnerDid(articleUri);
  if (did !== sessionDid || (ownerDid && ownerDid !== sessionDid)) {
    throw new HttpError(403, "Forbidden");
  }

  // Legacy ScholarView articles may use pre-TID rkeys. The schema-aware
  // `lex.delete()` validates the rkey as a TID before sending the request and
  // rejects those otherwise valid existing records, so delete by collection.
  try {
    await lex.deleteRecord(ARTICLE_COLLECTION, rkey);
  } catch (error) {
    const detail = error as { error?: unknown; message?: unknown; status?: unknown };
    const label = [detail.error, detail.message]
      .filter((value): value is string => typeof value === "string")
      .join(" ")
      .toLowerCase();
    if (detail.status !== 404 && !label.includes("not found")) throw error;
  }
  const announcement = await deleteArticleCascade(articleUri);

  let deletedAnnouncement = false;
  if (options.deleteAnnouncement !== false && announcement?.announcementUri) {
    try {
      const announcementAt = new AtUri(announcement.announcementUri);
      await lex.deleteRecord("app.bsky.feed.post", announcementAt.rkey);
      deletedAnnouncement = true;
    } catch {
      deletedAnnouncement = false;
    }
  }

  return json({
    success: true,
    deleted: {
      article: true,
      announcement: deletedAnnouncement,
    },
  });
}

async function createInlineComment(
  request: Request,
  did: string,
  rkey: string,
): Promise<Response> {
  const { did: sessionDid, lex } = await getAuthedLexClient();
  const articleUri = buildArticleUri(did, rkey);
  const announcement = await getAnnouncementByArticleUri(articleUri);
  if (!announcement) {
    throw new HttpError(409, "Inline comments require an announcement post");
  }

  const body = (await request.json()) as { text?: unknown; quote?: unknown };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const quote = typeof body.quote === "string" ? body.quote.trim() : "";

  if (!text) throw new HttpError(400, "Comment text is required");
  if (text.length > MAX_COMMENT_LENGTH) {
    throw new HttpError(400, `Comment text must be <= ${MAX_COMMENT_LENGTH} characters`);
  }
  if (!quote) throw new HttpError(400, "Quote is required");

  const normalizedQuote = quote.slice(0, MAX_QUOTE_LENGTH);
  const createdAt = new Date().toISOString();
  const externalUri = buildScholarViewArticleUrl(did, rkey, normalizedQuote);

  const created = await lex.createRecord({
    $type: "app.bsky.feed.post",
    text,
    createdAt,
    reply: {
      root: {
        uri: announcement.announcementUri,
        cid: announcement.announcementCid,
      },
      parent: {
        uri: announcement.announcementUri,
        cid: announcement.announcementCid,
      },
    },
    embed: {
      $type: "app.bsky.embed.external",
      external: {
        uri: externalUri,
        title: "ScholarView inline comment",
        description: normalizedQuote,
      },
    },
  });

  await upsertInlineComment({
    uri: created.body.uri,
    articleUri,
    authorDid: sessionDid,
    text,
    quote: normalizedQuote,
    externalUri,
    createdAt,
    indexedAt: createdAt,
  });

  return json({ success: true, commentUri: created.body.uri });
}

interface DiscussionItem {
  uri: string;
  cid: string | null;
  handle: string | null;
  authorDid: string;
  text: string;
  quote: string;
  externalUri: string;
  createdAt: string;
  parentUri: string | null;
  depth: number;
  source: "tap" | "live" | "merged";
}

function normalizeQuote(value: string): string {
  return value.trim();
}

function extractPostFromThreadNode(node: unknown): {
  uri: string;
  cid: string;
  handle: string | null;
  authorDid: string;
  text: string;
  quote: string;
  externalUri: string;
  createdAt: string;
  replies: unknown[];
} | null {
  const nodeObj = asObject(node);
  if (!nodeObj) return null;

  const post = asObject(nodeObj.post);
  if (!post) return null;

  const uri = asString(post.uri);
  if (!uri) return null;

  const cid = asString(post.cid);
  const author = asObject(post.author);
  const record = asObject(post.record);
  const embed = asObject(record?.embed);
  const external =
    embed &&
    (embed["$type"] === "app.bsky.embed.external#view" ||
      embed["$type"] === "app.bsky.embed.external")
      ? asObject(embed.external)
      : null;

  const externalUri = asString(external?.uri);
  const quote = normalizeQuote(
    extractQuoteFromExternalUri(externalUri) ?? asString(external?.description),
  );

  const repliesRaw = nodeObj.replies;
  const replies = Array.isArray(repliesRaw) ? repliesRaw : [];

  return {
    uri,
    cid: cid || "",
    handle: asString(author?.handle) || null,
    authorDid: asString(author?.did) || "",
    text: asString(record?.text),
    quote,
    externalUri,
    createdAt:
      asString(record?.createdAt) || asString(post.indexedAt) || new Date().toISOString(),
    replies,
  };
}

function flattenLiveReplies(
  node: unknown,
  depth: number,
  parentUri: string | null,
  out: DiscussionItem[],
): void {
  const post = extractPostFromThreadNode(node);
  if (!post) return;

  out.push({
    uri: post.uri,
    cid: post.cid || null,
    handle: post.handle,
    authorDid: post.authorDid,
    text: post.text,
    quote: post.quote,
    externalUri: post.externalUri,
    createdAt: post.createdAt,
    parentUri,
    depth,
    source: "live",
  });

  for (const child of post.replies) {
    flattenLiveReplies(child, depth + 1, post.uri, out);
  }
}

async function fetchThreadViaOAuth(announcementUri: string) {
  const fetchHandler = await getSessionFetchHandler();
  if (!fetchHandler) return null;

  const query = new URLSearchParams({
    uri: announcementUri,
    depth: "6",
    parentHeight: "0",
  });
  const response = await fetchHandler(
    `/xrpc/app.bsky.feed.getPostThread?${query.toString()}`,
  );
  if (!response.ok) return null;
  return (await response.json()) as unknown;
}

async function fetchThreadViaPublicApi(
  announcementUri: string,
  originalFetch: typeof fetch,
) {
  const query = new URLSearchParams({
    uri: announcementUri,
    depth: "6",
    parentHeight: "0",
  });
  const response = await originalFetch(
    `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?${query.toString()}`,
    { cache: "no-store" },
  );
  if (!response.ok) return null;
  return (await response.json()) as unknown;
}

async function getDiscussion(
  did: string,
  rkey: string,
  quoteFilter: string,
  originalFetch: typeof fetch,
): Promise<Response> {
  const articleUri = buildArticleUri(did, rkey);
  let announcement = await getAnnouncementByArticleUri(articleUri);
  const [sessionDid, localComments] = await Promise.all([
    getActiveDid(),
    getInlineCommentsByArticle(articleUri),
  ]);

  // Discovery: if announcement is missing from local DB (common for guests), try to find it
  if (!announcement) {
    const discovered = await discoverAnnouncement(did, rkey, originalFetch);
    if (discovered) {
      await upsertArticleAnnouncement({
        articleUri,
        announcementUri: discovered.uri,
        announcementCid: discovered.cid,
        authorDid: did,
        createdAt: new Date().toISOString(),
      });
      announcement = {
        articleUri,
        announcementUri: discovered.uri,
        announcementCid: discovered.cid,
        authorDid: did,
        createdAt: new Date().toISOString(),
      };
    }
  }

  if (!announcement) {
    return json({ success: true, root: null, thread: [] });
  }

  const normalizedRoot = await normalizeAnnouncementRootWithPublicApi(
    announcement.announcementUri,
    originalFetch,
  );
  if (normalizedRoot && normalizedRoot.uri !== announcement.announcementUri) {
    await upsertArticleAnnouncement({
      articleUri,
      announcementUri: normalizedRoot.uri,
      announcementCid: normalizedRoot.cid,
      authorDid: did,
      createdAt: new Date().toISOString(),
    });
    announcement = {
      ...announcement,
      announcementUri: normalizedRoot.uri,
      announcementCid: normalizedRoot.cid,
      createdAt: new Date().toISOString(),
    };
  }

  let payload: unknown = null;
  if (sessionDid) {
    try {
      payload = await fetchThreadViaOAuth(announcement.announcementUri);
    } catch {
      payload = null;
    }
  }
  if (!payload) {
    try {
      payload = await fetchThreadViaPublicApi(announcement.announcementUri, originalFetch);
    } catch {
      payload = null;
    }
  }

  const thread = asObject(payload)?.thread;
  const flattened: DiscussionItem[] = [];
  flattenLiveReplies(thread, 0, null, flattened);

  const liveRoot = flattened.shift() ?? null;
  const livePosts = flattened;

  const merged = new Map<string, DiscussionItem>();
  const liveOrder = new Map<string, number>();
  for (const [index, item] of livePosts.entries()) {
    liveOrder.set(item.uri, index);
    merged.set(item.uri, item);
  }

  for (const comment of localComments) {
    const existing = merged.get(comment.uri);
    if (existing) {
      merged.set(comment.uri, {
        ...existing,
        handle: comment.handle ?? existing.handle,
        authorDid: comment.authorDid || existing.authorDid,
        text: comment.text || existing.text,
        quote: comment.quote || existing.quote,
        externalUri: comment.externalUri || existing.externalUri,
        createdAt: comment.createdAt || existing.createdAt,
        source: "merged",
      });
      continue;
    }

    merged.set(comment.uri, {
      uri: comment.uri,
      cid: null,
      handle: comment.handle,
      authorDid: comment.authorDid,
      text: comment.text,
      quote: comment.quote,
      externalUri: comment.externalUri,
      createdAt: comment.createdAt,
      parentUri: announcement.announcementUri,
      depth: 1,
      source: "tap",
    });
  }

  const mergedPosts = Array.from(merged.values()).sort((a, b) => {
    const ai = liveOrder.get(a.uri);
    const bi = liveOrder.get(b.uri);
    if (ai !== undefined && bi !== undefined) return ai - bi;
    if (ai !== undefined) return -1;
    if (bi !== undefined) return 1;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  const subjectUris = [
    announcement.announcementUri,
    ...mergedPosts.map((item) => item.uri),
  ];
  const uniqueSubjectUris = Array.from(new Set(subjectUris));
  const interactions = sessionDid
    ? await listBskyInteractionsBySubjects(uniqueSubjectUris, sessionDid)
    : [];
  const interactionSet = new Set(
    interactions.map((item) => `${item.action}:${item.subjectUri}`),
  );

  const root = liveRoot
    ? {
        uri: liveRoot.uri,
        cid: liveRoot.cid ?? "",
        text: liveRoot.text || "Announcement post",
      }
    : {
        uri: announcement.announcementUri,
        cid: announcement.announcementCid,
        text: "Announcement post",
      };

  return json({
    success: true,
    root,
    thread: mergedPosts.map((post) => ({
      uri: post.uri,
      cid: post.cid,
      authorDid: post.authorDid,
      handle: post.handle,
      text: post.text,
      quote: post.quote,
      externalUri: post.externalUri,
      createdAt: post.createdAt,
      parentUri: post.parentUri,
      depth: post.depth,
      source: post.source,
      quoted: quoteFilter
        ? post.quote.toLowerCase().includes(quoteFilter.toLowerCase())
        : false,
      liked: interactionSet.has(`like:${post.uri}`),
      reposted: interactionSet.has(`repost:${post.uri}`),
    })),
  });
}

function parsePathname(pathname: string): string[] {
  return pathname.split("/").filter(Boolean).map(decodeParam);
}

async function handleArticlesPath(
  request: Request,
  url: URL,
  pathParts: string[],
  originalFetch: typeof fetch,
): Promise<Response | null> {
  if (pathParts.length === 2) {
    if (request.method === "GET") {
      try {
        await syncOwnArticlesFromRepo();
      } catch {
        // Keep listing locally cached articles even if sync fails.
      }
      const q = url.searchParams.get("q")?.trim() ?? "";
      const articles = await getRecentArticles(100, q);
      return json({ success: true, articles });
    }
    if (request.method === "POST") {
      return createArticle(request);
    }
    return null;
  }

  if (pathParts.length >= 4) {
    const did = pathParts[2];
    const rkey = pathParts[3];

    if (pathParts.length === 4) {
      if (request.method === "GET") return getArticle(did, rkey, originalFetch);
      if (request.method === "PUT") return updateArticle(request, did, rkey);
      if (request.method === "DELETE") return deleteArticle(did, rkey);
      return null;
    }

    if (pathParts.length === 5 && pathParts[4] === "comments") {
      if (request.method === "POST") return createInlineComment(request, did, rkey);
      return null;
    }

    if (pathParts.length === 5 && pathParts[4] === "discussion") {
      if (request.method !== "GET") return null;
      const quoteFilter = (url.searchParams.get("quote") ?? "").trim();
      return getDiscussion(did, rkey, quoteFilter, originalFetch);
    }
  }

  return null;
}

async function handleDraftsPath(
  request: Request,
  url: URL,
  pathParts: string[],
): Promise<Response | null> {
  if (pathParts.length === 2) {
    if (request.method === "GET") {
      const drafts = await listDrafts();
      return json({ success: true, drafts });
    }

    if (request.method === "POST") {
      const body = (await request.json()) as {
        id?: unknown;
        title?: unknown;
        content?: unknown;
        sourceFormat?: unknown;
      };
      const title = typeof body.title === "string" ? body.title.trim() : "";
      const content = typeof body.content === "string" ? body.content : "";
      const sourceFormat = sourceFormatFromUnknown(body.sourceFormat);
      const id = typeof body.id === "string" ? body.id : undefined;

      if (!title) throw new HttpError(400, "Title is required");
      if (title.length > MAX_TITLE_LENGTH) {
        throw new HttpError(400, `Title must be <= ${MAX_TITLE_LENGTH} characters`);
      }
      if (!content.trim()) throw new HttpError(400, "Content is required");
      if (content.length > MAX_DRAFT_CONTENT_LENGTH) {
        throw new HttpError(
          400,
          `Content must be <= ${MAX_DRAFT_CONTENT_LENGTH} characters`,
        );
      }

      const draft = await saveDraft({
        id,
        title,
        content,
        sourceFormat,
      });
      return json({ success: true, draftId: draft.id, draft });
    }

    if (request.method === "DELETE") {
      const id = url.searchParams.get("id");
      if (!id) throw new HttpError(400, "Draft id is required");
      await deleteDraftById(id);
      return json({ success: true });
    }
    return null;
  }

  if (pathParts.length === 3) {
    const id = pathParts[2];
    if (request.method === "GET") {
      const draft = await getDraftById(id);
      if (!draft) throw new HttpError(404, "Draft not found");
      return json({ success: true, draft });
    }

    if (request.method === "DELETE") {
      await deleteDraftById(id);
      return json({ success: true });
    }
  }

  return null;
}

function blocksToSource(blocks: ArticleBlock[], sourceFormat: SourceFormat): string {
  if (sourceFormat === "tex") {
    return blocks
      .map((block) => {
        const level = block.level <= 1 ? 1 : block.level === 2 ? 2 : 3;
        const command =
          level === 1 ? "\\section" : level === 2 ? "\\subsection" : "\\subsubsection";
        const heading = `${command}{${block.heading}}`;
        const content = block.content.trim();
        return content ? `${heading}\n\n${content}` : heading;
      })
      .join("\n\n")
      .trim();
  }

  return blocks
    .map((block) => {
      const heading = `${"#".repeat(Math.max(1, Math.min(3, block.level)))} ${block.heading}`;
      const content = block.content.trim();
      return content ? `${heading}\n\n${content}` : heading;
    })
    .join("\n\n")
    .trim();
}

function sanitizeBaseName(input: string): string {
  const sanitized = input
    .trim()
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return sanitized || "article";
}

function uniqueFileName(
  title: string,
  sourceFormat: SourceFormat,
  existingNames: Set<string>,
  fallbackSeed: string,
): string {
  const ext = sourceFormat === "tex" ? "tex" : "md";
  const base = sanitizeBaseName(title || fallbackSeed);

  let n = 0;
  for (;;) {
    const candidate = n === 0 ? `${base}.${ext}` : `${base}-${n + 1}.${ext}`;
    const key = candidate.toLowerCase();
    if (!existingNames.has(key)) {
      existingNames.add(key);
      return candidate;
    }
    n += 1;
  }
}

interface SyncConflict {
  fileId: string;
  articleUri: string;
  did: string;
  rkey: string;
  title: string;
}

// Materialize an article's body into the workspace at its published `sourcePath`
// (restoring folder structure). Non-destructive: if a file already occupies that
// path, fall back to a unique root name rather than touching the existing file.
async function materializeArticleBody(
  did: string,
  detail: ArticleDetail,
  content: string,
  sourceFormat: SourceFormat,
  existingNames: Set<string>,
): Promise<WorkspaceFileNode | null> {
  const desiredPath = detail.sourcePath ? normalizeWorkspacePath(detail.sourcePath) : null;
  if (desiredPath && !(await getWorkspaceFileByPath(desiredPath, did))) {
    const created = await ensureWorkspaceFileAtPath(did, desiredPath, { content, sourceFormat });
    if (created && created.kind === "file") return created;
  }
  const name = uniqueFileName(detail.title, sourceFormat, existingNames, detail.rkey);
  return createWorkspaceFile({
    ownerDid: did,
    parentId: null,
    name,
    kind: "file",
    sourceFormat,
    content,
  });
}

async function syncLegacyArticles(force = false): Promise<Response> {
  // Restore project containers first, so article sourcePath hydration lands in
  // the intended subtree on a clean browser.
  const projectHydration = await hydratePaperProjects();
  await syncOwnArticlesFromRepo({ force });
  const did = await requireDid();
  const [allArticles, existingFiles] = await Promise.all([
    getRecentArticles(500),
    listWorkspaceFiles(did),
  ]);
  const myArticles = allArticles.filter((article) => article.authorDid === did);
  const existingNames = new Set(existingFiles.map((file) => file.name.toLowerCase()));

  let created = 0;
  const conflicts: SyncConflict[] = [];

  for (const article of myArticles) {
    const detail = await getArticleByDidAndRkey(article.did, article.rkey);
    if (!detail) continue;

    const sourceFormat = detail.sourceFormat === "tex" ? "tex" : "markdown";
    const remoteContent = blocksToSource(detail.blocks, sourceFormat);
    const remoteHash = hashContent(remoteContent);
    const existingLinked = await getWorkspaceFileByLinkedArticleUri(article.uri, did);

    const decision = evaluateSync({
      hasLocal: Boolean(existingLinked),
      baselineLocalHash: existingLinked?.syncedContentHash,
      baselineRemoteHash: existingLinked?.syncedRemoteHash,
      localContent: existingLinked?.content ?? "",
      remoteContent,
    });

    switch (decision.action) {
      case "materialize": {
        const file = await materializeArticleBody(
          did,
          detail,
          remoteContent,
          sourceFormat,
          existingNames,
        );
        if (!file) break;
        await updateWorkspaceFileById(file.id, did, {
          linkedArticleDid: article.did,
          linkedArticleRkey: article.rkey,
          linkedArticleUri: article.uri,
          syncedContentHash: remoteHash,
          syncedRemoteHash: remoteHash,
        });
        await hydrateArticleAssets(did, detail, file);
        created += 1;
        break;
      }
      case "auto-update": {
        if (!existingLinked) break;
        // Local is clean; safe to pull the newer published version.
        await updateWorkspaceFileById(existingLinked.id, did, {
          content: remoteContent,
          sourceFormat,
          linkedArticleDid: article.did,
          linkedArticleRkey: article.rkey,
          linkedArticleUri: article.uri,
          syncedContentHash: remoteHash,
          syncedRemoteHash: remoteHash,
        });
        await hydrateArticleAssets(did, detail, existingLinked);
        break;
      }
      case "adopt-baseline": {
        if (!existingLinked) break;
        // Legacy linked file: record baseline from current local + remote, do not overwrite.
        await updateWorkspaceFileById(existingLinked.id, did, {
          linkedArticleDid: article.did,
          linkedArticleRkey: article.rkey,
          linkedArticleUri: article.uri,
          syncedContentHash: hashContent(existingLinked.content ?? ""),
          syncedRemoteHash: remoteHash,
        });
        await hydrateArticleAssets(did, detail, existingLinked);
        break;
      }
      case "conflict": {
        // Unpublished local edits AND a newer remote version: never overwrite silently.
        if (existingLinked) {
          conflicts.push({
            fileId: existingLinked.id,
            articleUri: article.uri,
            did: article.did,
            rkey: article.rkey,
            title: detail.title,
          });
        }
        break;
      }
      default:
        break;
    }
  }

  const files = await listWorkspaceFiles(did);
  return json({
    success: true,
    created: created + projectHydration.created,
    projectFilesCreated: projectHydration.created,
    conflicts,
    files,
  });
}

async function seedWelcomeWorkspace(did: string): Promise<void> {
  const tutorialFolder = await createWorkspaceFile({
    ownerDid: did,
    parentId: null,
    name: "tutorial",
    kind: "folder",
  });

  const imgFolder = await createWorkspaceFile({
    ownerDid: did,
    parentId: tutorialFolder.id,
    name: "images",
    kind: "folder",
  });

  const transparentPixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
  await createWorkspaceFile({
    ownerDid: did,
    parentId: imgFolder.id,
    name: "sample-image.png",
    kind: "file",
    sourceFormat: null, // Image should not have markdown format
    content: transparentPixel,
  });

  const bibContent = `@article{scholarview2026,
  author = {ScholarView Team},
  title = {DeSci Review and Publishing on AT Protocol},
  journal = {Journal of Open Science},
  year = {2026},
  volume = {1},
  pages = {1-10}
}`;

  await createWorkspaceFile({
    ownerDid: did,
    parentId: tutorialFolder.id,
    name: "references.bib",
    kind: "file",
    sourceFormat: "markdown",
    content: bibContent,
  });

  await createWorkspaceFile({
    ownerDid: did,
    parentId: tutorialFolder.id,
    name: "welcome.md",
    kind: "file",
    sourceFormat: "markdown",
    content: `# ScholarView Comprehensive Guide

Welcome to your DeSci workspace! This document covers everything you can do with ScholarView's Markdown editor.

## 1. Document Structure

# Level 1 Heading
## Level 2 Heading
### Level 3 Heading

You can create lists:
- Item A
- Item B
  - Sub-item B1
1. Numbered List
2. Another Item

> This is a blockquote. Use it for emphasized text or external quotes.

---

## 2. Mathematical Notation (LaTeX)

ScholarView uses KaTeX for fast and beautiful math rendering.

**Inline Math**: Use single dollar signs: $E = mc^2$ or $\\lambda = \\frac{h}{p}$.

**Display (Block) Math**: Use double dollar signs for multi-line or centered equations:

$$
I = \\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}
$$

You can also use complex environments:

$$
\\begin{pmatrix}
a & b \\\\
c & d
\\end{pmatrix}
\\cdot
\\begin{pmatrix}
x \\\\
y
\\end{pmatrix}
=
\\begin{pmatrix}
ax + by \\\\
cx + dy
\\end{pmatrix}
$$

## 3. Citations and References

ScholarView handles academic citations automatically.
1. Create a \`.bib\` file in your workspace (see \`references.bib\` in this folder).
2. Use the \`[@citekey]\` syntax in your text.

Example: ScholarView is built for decentralized science [@scholarview2026].

*Tip: Click the citation icon in the block menu to browse and insert references from your bib files.*

## 4. Media and Image Assets

Embed images from your workspace using the \`workspace://\` protocol:

![Sample Figure](workspace://sample-image.png)
*Figure 1: A transparent placeholder image stored in the images/ folder.*

## 5. Rich Renderer Features

The panel on the right is a **Rich Renderer**. It doesn't just show a preview; it parses your document into semantic blocks.
- **Click a block** in the renderer to jump to that line in the editor.
- **Drag handle** (on the left of the editor) to reorder sections of your paper.

## 6. Publishing (Broadcast)

When your paper is ready:
1. Click **Broadcast** at the top right.
2. Sign in with your AT Protocol (Bluesky) account.
3. Your article will be published as a record on your repository.
4. A discussion thread will be automatically created on Bluesky!

Happy writing and reviewing!`,
  });
}

async function handleWorkspaceFilesPath(
  request: Request,
  pathParts: string[],
): Promise<Response | null> {
  if (pathParts.length === 3) {
    const did = await getDidOrLocal();
    if (request.method === "GET") {
      let files = await listWorkspaceFiles(did);
      if (files.length === 0 && did === "local") {
        await seedWelcomeWorkspace(did);
        files = await listWorkspaceFiles(did);
      }
      return json({ success: true, files });
    }

    if (request.method === "POST") {
      const body = (await request.json()) as {
        parentId?: unknown;
        name?: unknown;
        kind?: unknown;
        format?: unknown;
        content?: unknown;
      };
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) throw new HttpError(400, "name is required");
      if (name.length > 120) throw new HttpError(400, "name is too long");

      const parentId = typeof body.parentId === "string" ? body.parentId : null;
      if (parentId) {
        const parent = await getWorkspaceFileById(parentId, did);
        if (!parent) throw new HttpError(404, "parent not found");
        if (parent.kind !== "folder") throw new HttpError(400, "parent must be folder");
      }

      const kind = body.kind === "folder" ? "folder" : "file";
      const sourceFormat =
        body.format === "tex" || name.toLowerCase().endsWith(".tex") ? "tex" : "markdown";
      const content = typeof body.content === "string" ? body.content : "";

      const file = await createWorkspaceFile({
        ownerDid: did,
        parentId,
        name,
        kind,
        sourceFormat: kind === "file" ? sourceFormat : null,
        content: kind === "file" ? content : null,
      });

      return json({ success: true, file });
    }
    return null;
  }

  if (pathParts.length >= 4) {
    const did = await getDidOrLocal();
    const id = pathParts[3];

    if (id === "move") {
      if (request.method !== "POST") return null;
      const body = (await request.json()) as {
        draggedId: string;
        targetId: string;
        position: "before" | "after" | "inside";
      };
      const result = await moveWorkspaceFile(
        body.draggedId,
        body.targetId,
        body.position,
        did,
      );
      if (!result.success) {
        throw new HttpError(400, result.error ?? "Failed to move item");
      }
      return json({ success: true, updates: result.updates || [] });
    }

    if (pathParts.length === 4) {
      if (request.method === "PATCH") {
        const existing = await getWorkspaceFileById(id, did);
        if (!existing) throw new HttpError(404, "file not found");

        const body = (await request.json()) as {
          parentId?: unknown;
          name?: unknown;
          content?: unknown;
          sortOrder?: unknown;
          expanded?: unknown;
          sourceFormat?: unknown;
          linkedArticleDid?: unknown;
          linkedArticleRkey?: unknown;
          linkedArticleUri?: unknown;
        };

        const parentId =
          body.parentId === null
            ? null
            : typeof body.parentId === "string"
              ? body.parentId
              : undefined;
        const name = typeof body.name === "string" ? body.name.trim() : undefined;
        const content = typeof body.content === "string" ? body.content : undefined;
        const sortOrder =
          typeof body.sortOrder === "number" && Number.isFinite(body.sortOrder)
            ? Math.max(0, Math.floor(body.sortOrder))
            : undefined;
        const expanded =
          body.expanded === 1 || body.expanded === true
            ? 1
            : body.expanded === 0 || body.expanded === false
              ? 0
              : undefined;
        const sourceFormat =
          body.sourceFormat === undefined
            ? undefined
            : sourceFormatFromUnknown(body.sourceFormat);
        const linkedArticleDid =
          body.linkedArticleDid === null
            ? null
            : typeof body.linkedArticleDid === "string"
              ? body.linkedArticleDid
              : undefined;
        const linkedArticleRkey =
          body.linkedArticleRkey === null
            ? null
            : typeof body.linkedArticleRkey === "string"
              ? body.linkedArticleRkey
              : undefined;
        const linkedArticleUri =
          body.linkedArticleUri === null
            ? null
            : typeof body.linkedArticleUri === "string"
              ? body.linkedArticleUri
              : undefined;

        if (name !== undefined && !name) {
          throw new HttpError(400, "name must not be empty");
        }
        if (parentId !== undefined && parentId !== null) {
          if (parentId === id) throw new HttpError(400, "invalid parentId");
          const parent = await getWorkspaceFileById(parentId, did);
          if (!parent || parent.kind !== "folder") {
            throw new HttpError(404, "parent folder not found");
          }
        }

        const updated = await updateWorkspaceFileById(id, did, {
          parentId,
          name,
          content,
          sortOrder,
          expanded,
          sourceFormat,
          linkedArticleDid,
          linkedArticleRkey,
          linkedArticleUri,
        });

        return json({ success: true, file: updated });
      }

      if (request.method === "DELETE") {
        const deleteOptions = (await request.json().catch(() => ({}))) as {
          deleteAnnouncement?: unknown;
        };
        const deleteAnnouncement = deleteOptions.deleteAnnouncement !== false;
        const existing = await getWorkspaceFileById(id, did);
        if (!existing) throw new HttpError(404, "file not found");
        const allFiles = await listWorkspaceFiles(did);
        const byId = new Map(allFiles.map((file) => [file.id, file]));
        const isInDeletedSubtree = (file: WorkspaceFileNode) => {
          if (file.id === existing.id) return true;
          let parentId = file.parentId;
          while (parentId) {
            if (parentId === existing.id) return true;
            parentId = byId.get(parentId)?.parentId ?? null;
          }
          return false;
        };
        const deletedArticles = allFiles.filter(
          (file) => file.kind === "file" && Boolean(file.linkedArticleUri) && isInDeletedSubtree(file),
        );
        const affectedProjectRootIds = new Set(
          deletedArticles.map((file) => file.parentId).filter((value): value is string => Boolean(value)),
        );
        if (affectedProjectRootIds.size > 0) {
          const lex = await getLexClientForCurrentSession();
          if (!lex) throw new HttpError(401, "Unauthorized");
          for (const rootId of affectedProjectRootIds) {
            const hasRemainingPublishedArticle = allFiles.some(
              (file) =>
                file.kind === "file" &&
                Boolean(file.linkedArticleUri) &&
                file.parentId === rootId &&
                !isInDeletedSubtree(file),
            );
            const projectRoot = byId.get(rootId);
            if (!hasRemainingPublishedArticle && projectRoot?.kind === "folder") {
              await deleteReleasedPaperProject({ did, lex, projectRoot, files: allFiles });
            }
          }
        }
        for (const articleFile of deletedArticles) {
          if (articleFile.linkedArticleDid && articleFile.linkedArticleRkey) {
            await deleteArticle(articleFile.linkedArticleDid, articleFile.linkedArticleRkey, {
              deleteAnnouncement,
            });
          }
        }
        const projectRootId = findPublishedProjectRootForNode(allFiles, existing.id);
        if (projectRootId) {
          const published = await getPaperRecordBinding(
            bindingKey(did, "workspaceProject", projectRootId),
          );
          if (published) {
            await upsertPaperRecordBinding({
              key: bindingKey(did, "workspaceProjectHydration", published.uri),
              ownerDid: did,
              kind: "workspaceProjectHydration",
              localId: projectRootId,
              uri: published.uri,
              cid: published.cid,
              syncedHash: published.cid,
              updatedAt: new Date().toISOString(),
            });
          }
        }
        await deleteWorkspaceFileById(id, did);
        return json({ success: true });
      }
      return null;
    }

    if (pathParts.length === 5 && pathParts[4] === "publish") {
      if (request.method !== "POST") return null;
      return publishWorkspaceFile(request, id, did);
    }

    if (pathParts.length === 5 && pathParts[4] === "pull") {
      if (request.method !== "POST") return null;
      return pullWorkspaceFileFromPds(request, id, did);
    }
  }

  return null;
}

async function findThreadTail(
  announcementUri: string,
  authorDid: string,
  lex: Client,
): Promise<{ uri: string; cid: string }> {
  try {
    const query = new URLSearchParams({
      uri: announcementUri,
      depth: "100",
      parentHeight: "0",
    });
    const response = await lex.fetchHandler(
      `/xrpc/app.bsky.feed.getPostThread?${query.toString()}`,
      { method: "GET" },
    );
    if (!response.ok) return { uri: announcementUri, cid: await resolveCid(announcementUri) };
    const payload = (await response.json()) as { thread?: unknown };
    const thread = asObject(payload.thread);
    if (!thread) return { uri: announcementUri, cid: await resolveCid(announcementUri) };

    const authorPosts: Array<{ uri: string; cid: string; createdAt: string }> = [];
    const traverse = (node: unknown) => {
      const post = asObject(asObject(node)?.post);
      if (!post) return;
      
      const postAuthor = asObject(post.author);
      const postAuthorDid = asString(postAuthor?.did);
      
      // Only collect posts made by the article author
      if (postAuthorDid === authorDid) {
        const uri = asString(post.uri);
        const cid = asString(post.cid);
        const record = asObject(post.record);
        const createdAt = asString(record?.createdAt) || new Date().toISOString();
        if (uri && cid) authorPosts.push({ uri, cid, createdAt });
      }

      const replies = Array.isArray(asObject(node)?.replies) ? asObject(node)?.replies : [];
      for (const reply of (replies as unknown[])) traverse(reply);
    };

    traverse(thread);
    
    // Sort by createdAt ascending to find the very last post by the author
    authorPosts.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    
    if (authorPosts.length > 0) {
      return {
        uri: authorPosts[authorPosts.length - 1].uri,
        cid: authorPosts[authorPosts.length - 1].cid,
      };
    }
  } catch (e) {
    console.error("Failed to find thread tail:", e);
  }
  return { uri: announcementUri, cid: await resolveCid(announcementUri) };
}

async function publishWorkspaceFile(
  request: Request,
  fileId: string,
  did: string,
): Promise<Response> {
  const lex = await getLexClientForCurrentSession();
  const file = await getWorkspaceFileById(fileId, did);
  if (!file) throw new HttpError(404, "File not found");
  if (file.kind !== "file") throw new HttpError(400, "Only files can be published");

  const body = (await request.json()) as {
    title?: unknown;
    authors?: unknown;
    broadcastToBsky?: unknown;
    notifyUpdate?: unknown;
    broadcastText?: unknown;
    bibliography?: unknown;
    projectBibliography?: unknown;
  };

  const customBroadcastText = typeof body.broadcastText === "string" ? body.broadcastText : null;
  const shouldBroadcast = body.broadcastToBsky === true;
  const shouldNotifyUpdate = body.notifyUpdate === true;

  const title =
    typeof body.title === "string" && body.title.trim()
      ? body.title.trim()
      : file.name.replace(/\.[^.]+$/, "").trim() || "Untitled";
  if (title.length > MAX_TITLE_LENGTH) {
    throw new HttpError(400, `Title must be <= ${MAX_TITLE_LENGTH} characters`);
  }

  const authors = Array.isArray(body.authors) ? (body.authors as ArticleAuthor[]) : [];
  const sourceFormat = file.sourceFormat === "tex" ? "tex" : "markdown";
  const rawText = file.content ?? "";

  const resolved = await resolveWorkspaceImports({
    text: rawText,
    sourceFormat,
    resolveFileByPath: (path) => getWorkspaceFileByPath(path, did),
  });

  const blocks =
    sourceFormat === "tex"
      ? parseTexToBlocks(resolved.resolvedText)
      : parseMarkdownToBlocks(resolved.resolvedText);
  if (blocks.length === 0) throw new HttpError(400, "At least one section is required");

  const bibliographyInput =
    body.bibliography === undefined ? null : normalizeBibliography(body.bibliography);
  const projectBibliographyInput =
    body.projectBibliography === undefined
      ? null
      : normalizeBibliography(body.projectBibliography);
  const now = new Date().toISOString();
  const linkedDid = file.linkedArticleDid;
  const linkedRkey = file.linkedArticleRkey;
  const existing =
    linkedDid && linkedRkey ? await getArticleByDidAndRkey(linkedDid, linkedRkey) : null;

  // Record the body file's workspace path so other devices can restore folder structure.
  const allWorkspaceFiles = await listWorkspaceFiles(did);
  const sourcePath = buildWorkspaceFilePath(file, allWorkspaceFiles) ?? undefined;

  const imageAssets = await buildWorkspaceArticleImageAssets(
    lex,
    blocks,
    sourceFormat,
    did,
    file,
    existing?.images ?? [],
  );

  let mode: "created" | "updated" = "created";
  let targetDid = did;
  let targetRkey = "";
  let articleUri = "";
  let broadcasted: 0 | 1 = 0;

  if (existing) {
    if (existing.authorDid !== did) throw new HttpError(403, "Forbidden");
    mode = "updated";
    targetDid = existing.did;
    targetRkey = existing.rkey;
    articleUri = existing.uri;

    // Guard against wiping the stored bibliography when the client sends an empty
    // set (e.g. editing on a device whose .bib file has not been hydrated yet).
    const bibliography = compactBibliography(
      bibliographyInput && bibliographyInput.length > 0
        ? bibliographyInput
        : existing.bibliography,
    );

    await lex.put(
      sci.peer.article.main,
      {
        title,
        authors,
        blocks,
        bibliography,
        images: imageAssets as unknown as sci.peer.article.ImageAsset[],
        ...(sourcePath ? { sourcePath } : {}),
        createdAt: new Date(existing.createdAt).toISOString(),
      },
      { rkey: targetRkey },
    );

    let announcement = await getAnnouncementByArticleUri(articleUri);
    // Discovery: if announcement is missing from local DB, try to find it via author's feed
    if (!announcement) {
      const discovered = await discoverAnnouncement(did, targetRkey, fetch);
      if (discovered) {
        await upsertArticleAnnouncement({
          articleUri,
          announcementUri: discovered.uri,
          announcementCid: discovered.cid,
          authorDid: did,
          createdAt: now,
        });
        announcement = {
          articleUri,
          announcementUri: discovered.uri,
          announcementCid: discovered.cid,
          authorDid: did,
          createdAt: now,
        };
      }
    }
    if (announcement) {
      const normalizedRoot =
        (await normalizeAnnouncementRootWithLex(announcement.announcementUri, lex)) ??
        (await normalizeAnnouncementRootWithPublicApi(announcement.announcementUri, fetch));
      if (normalizedRoot && normalizedRoot.uri !== announcement.announcementUri) {
        await upsertArticleAnnouncement({
          articleUri,
          announcementUri: normalizedRoot.uri,
          announcementCid: normalizedRoot.cid,
          authorDid: did,
          createdAt: now,
        });
        announcement = {
          ...announcement,
          announcementUri: normalizedRoot.uri,
          announcementCid: normalizedRoot.cid,
          createdAt: now,
        };
      }
    }

    if (shouldBroadcast && shouldNotifyUpdate) {
      if (!announcement && existing.broadcasted === 1) {
        throw new HttpError(
          409,
          "Existing discussion root was not found. Open the discussion once and retry.",
        );
      }

      const atprotoAtUrl = buildScholarViewArticleUrl(targetDid, targetRkey);
      let postText = `更新した論文を公開しました：『${title}』 ${atprotoAtUrl}`;
      let embedUri = atprotoAtUrl;

      if (customBroadcastText) {
        postText = customBroadcastText.replace(/\{\{article_url\}\}/g, atprotoAtUrl);
        // Try to extract the edited URL from the text to use for the link card
        const urlMatch = postText.match(/https?:\/\/[^\s]+/);
        if (urlMatch) {
          embedUri = urlMatch[0];
        }
      }

      console.log(`[Publish] Broadcasting update. Text: "${postText}", Embed: ${embedUri}`);

      // If we have an existing announcement, we want to reply to the tail of the thread
      let reply: { root: { uri: string; cid: string }; parent: { uri: string; cid: string } } | undefined = undefined;
      if (announcement) {
        // Use author DID (did) to find the correct tail
        const tail = await findThreadTail(announcement.announcementUri, did, lex);
        reply = {
          root: { uri: announcement.announcementUri, cid: announcement.announcementCid },
          parent: { uri: tail.uri, cid: tail.cid },
        };
      }

      const post = await lex.createRecord({
        $type: "app.bsky.feed.post",
        text: postText,
        createdAt: now,
        ...(reply ? { reply } : {}),
        embed: {
          $type: "app.bsky.embed.external",
          external: {
            uri: embedUri,
            title,
            description: "ScholarViewで論文を公開しました",
          },
        },
      });

      if (!announcement) {
        await upsertArticleAnnouncement({
          articleUri,
          announcementUri: post.body.uri,
          announcementCid: post.body.cid,
          authorDid: did,
          createdAt: now,
        });
      }
      broadcasted = 1;
    } else {
      broadcasted = announcement ? 1 : 0;
    }

    await updateArticleByUri(articleUri, {
      title,
      authorsJson: JSON.stringify(authors),
      blocksJson: serializeBlocks(blocks),
      bibliographyJson: serializeBibliography(bibliography),
      imagesJson: JSON.stringify(imageAssets),
      sourceFormat,
      indexedAt: now,
      broadcasted,
      sourcePath: sourcePath ?? null,
    });
  } else {
    mode = "created";
    const bibliography = compactBibliography(bibliographyInput ?? []);
    const created = await lex.create(sci.peer.article.main, {
      title,
      authors,
      blocks,
      bibliography,
      images: imageAssets as unknown as sci.peer.article.ImageAsset[],
      ...(sourcePath ? { sourcePath } : {}),
      createdAt: now,
    });

    const atUri = new AtUri(created.uri);

    targetDid = did;
    targetRkey = atUri.rkey;
    articleUri = created.uri;

    let announcement: { uri: string; cid: string } | null = null;
    if (shouldBroadcast) {
      const atprotoAtUrl = buildScholarViewArticleUrl(targetDid, targetRkey);
      let postText = `新しい論文/実験計画を公開しました：『${title}』 ${atprotoAtUrl}`;
      let embedUri = atprotoAtUrl;

      if (customBroadcastText) {
        postText = customBroadcastText.replace(/\{\{article_url\}\}/g, atprotoAtUrl);
        const urlMatch = postText.match(/https?:\/\/[^\s]+/);
        if (urlMatch) {
          embedUri = urlMatch[0];
        }
      }

      console.log(`[Publish] Broadcasting new article. Text: "${postText}", Embed: ${embedUri}`);

      const post = await lex.createRecord({
        $type: "app.bsky.feed.post",
        text: postText,
        createdAt: now,
        embed: {
          $type: "app.bsky.embed.external",
          external: {
            uri: embedUri,
            title,
            description: "ScholarViewで論文を公開しました",
          },
        },
      });
      announcement = { uri: post.body.uri, cid: post.body.cid };
    }

    await upsertArticle({
      uri: articleUri,
      authorDid: did,
      title,
      authorsJson: JSON.stringify(authors),
      blocksJson: serializeBlocks(blocks),
      bibliographyJson: serializeBibliography(bibliography),
      imagesJson: JSON.stringify(imageAssets),
      sourceFormat,
      broadcasted: announcement ? 1 : 0,
      createdAt: now,
      indexedAt: now,
      sourcePath: sourcePath ?? null,
    });

    if (announcement) {
      await upsertArticleAnnouncement({
        articleUri,
        announcementUri: announcement.uri,
        announcementCid: announcement.cid,
        authorDid: did,
        createdAt: now,
      });
      broadcasted = 1;
    } else {
      broadcasted = 0;
    }
  }

  // Record the sync baseline: local hash = this device's rich source (rawText),
  // remote hash = the published round-tripped content. This keeps the authoring
  // device "clean" and lets other devices detect the new published version.
  const publishedRemoteContent = blocksToSource(blocks, sourceFormat);
  const updatedFile = await updateWorkspaceFileById(fileId, did, {
    linkedArticleDid: targetDid,
    linkedArticleRkey: targetRkey,
    linkedArticleUri: articleUri,
    syncedContentHash: hashContent(rawText),
    syncedRemoteHash: hashContent(publishedRemoteContent),
  });

  // A folder containing a published paper is the project boundary. Release its
  // structure and references as a separate, idempotent pub.paper.* layer.
  if (updatedFile?.parentId) {
    const [projectRoot, releasedFiles, releasedArticle] = await Promise.all([
      getWorkspaceFileById(updatedFile.parentId, did),
      listWorkspaceFiles(did),
      getArticleByDidAndRkey(targetDid, targetRkey),
    ]);
    if (projectRoot?.kind === "folder") {
      await releasePaperProject({
        did,
        lex,
        projectRoot,
        files: releasedFiles,
        bibliography:
          projectBibliographyInput ?? releasedArticle?.bibliography ?? [],
      });
    }
  }

  return json({
    success: true,
    mode,
    did: targetDid,
    rkey: targetRkey,
    uri: articleUri,
    broadcasted,
    diagnostics: resolved.diagnostics,
    file: updatedFile,
  });
}

// Explicit "Pull from PDS (replace local)" — the symmetric operation to Publish.
// Overwrites the local file with the published version. Optionally keeps the
// current local content as a separate (unlinked) copy so nothing is lost.
async function pullWorkspaceFileFromPds(
  request: Request,
  fileId: string,
  did: string,
): Promise<Response> {
  const file = await getWorkspaceFileById(fileId, did);
  if (!file) throw new HttpError(404, "File not found");
  if (file.kind !== "file") throw new HttpError(400, "Only files can be pulled");
  if (!file.linkedArticleDid || !file.linkedArticleRkey) {
    throw new HttpError(409, "File is not linked to a published article");
  }

  const body = (await request.json().catch(() => ({}))) as { keepBackup?: unknown };
  const keepBackup = body.keepBackup === true;

  try {
    await syncOwnArticlesFromRepo({ force: true });
  } catch {
    // Fall back to the cached article if the refresh fails.
  }
  const detail = await getArticleByDidAndRkey(file.linkedArticleDid, file.linkedArticleRkey);
  if (!detail) throw new HttpError(404, "Published article not found");

  const sourceFormat = detail.sourceFormat === "tex" ? "tex" : "markdown";
  const remoteContent = blocksToSource(detail.blocks, sourceFormat);
  const remoteHash = hashContent(remoteContent);

  let backupFile: WorkspaceFileNode | null = null;
  if (keepBackup) {
    const dotIndex = file.name.lastIndexOf(".");
    const stem = dotIndex > 0 ? file.name.slice(0, dotIndex) : file.name;
    const ext = dotIndex > 0 ? file.name.slice(dotIndex) : "";
    backupFile = await createWorkspaceFile({
      ownerDid: did,
      parentId: file.parentId,
      name: `${stem} (local copy)${ext}`,
      kind: "file",
      sourceFormat,
      content: file.content ?? "",
    });
  }

  const updated = await updateWorkspaceFileById(fileId, did, {
    content: remoteContent,
    sourceFormat,
    syncedContentHash: remoteHash,
    syncedRemoteHash: remoteHash,
  });
  if (updated) {
    await hydrateArticleAssets(did, detail, updated);
  }

  return json({ success: true, file: updated, backupFile });
}

async function handleWorkspaceImportResolve(request: Request): Promise<Response> {
  const did = await getDidOrLocal();
  const body = (await request.json()) as {
    sourceFormat?: unknown;
    text?: unknown;
  };

  const sourceFormat = sourceFormatFromUnknown(body.sourceFormat);
  const text = typeof body.text === "string" ? body.text : "";
  const resolved = await resolveWorkspaceImports({
    text,
    sourceFormat,
    resolveFileByPath: (path) => getWorkspaceFileByPath(path, did),
  });

  return json({
    success: true,
    resolvedText: resolved.resolvedText,
    diagnostics: resolved.diagnostics,
  });
}

function parseAction(input: unknown): BskyInteractionAction | null {
  if (input === "like" || input === "repost" || input === "reply") return input;
  return null;
}

async function resolveCid(uri: string): Promise<string> {
  const atUri = new AtUri(uri);
  const fetchHandler = await getSessionFetchHandler();
  if (!fetchHandler) throw new HttpError(400, "Failed to resolve subject cid");

  const query = new URLSearchParams({
    repo: atUri.hostname,
    collection: atUri.collection,
    rkey: atUri.rkey,
  });
  const response = await fetchHandler(`/xrpc/com.atproto.repo.getRecord?${query.toString()}`);
  if (!response.ok) throw new HttpError(400, "Failed to resolve subject cid");

  const payload = (await response.json()) as { cid?: unknown };
  const cid = typeof payload.cid === "string" ? payload.cid : "";
  if (!cid) throw new HttpError(400, "Failed to resolve subject cid");
  return cid;
}

async function handleEngagement(request: Request): Promise<Response> {
  const { did, lex } = await getAuthedLexClient();
  const body = (await request.json()) as {
    action?: unknown;
    uri?: unknown;
    cid?: unknown;
    text?: unknown;
  };
  const action = parseAction(body.action);
  const uri = typeof body.uri === "string" ? body.uri.trim() : "";
  let cid = typeof body.cid === "string" ? body.cid.trim() : "";

  if (!action || !uri) throw new HttpError(400, "action and uri are required");
  try {
    // Validate AT URI
    new AtUri(uri);
  } catch {
    throw new HttpError(400, "Invalid AT URI");
  }

  if (!cid) {
    cid = await resolveCid(uri);
  }

  const createdAt = new Date().toISOString();
  let recordUri = "";
  if (action === "like") {
    const created = await lex.createRecord({
      $type: "app.bsky.feed.like",
      subject: { uri, cid },
      createdAt,
    });
    recordUri = created.body.uri;
  } else if (action === "repost") {
    const created = await lex.createRecord({
      $type: "app.bsky.feed.repost",
      subject: { uri, cid },
      createdAt,
    });
    recordUri = created.body.uri;
  } else {
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) throw new HttpError(400, "text is required for reply");
    const created = await lex.createRecord({
      $type: "app.bsky.feed.post",
      text,
      createdAt,
      reply: {
        root: { uri, cid },
        parent: { uri, cid },
      },
    });
    recordUri = created.body.uri;
  }

  await upsertBskyInteraction({
    uri: recordUri,
    subjectUri: uri,
    subjectCid: cid,
    authorDid: did,
    action,
    createdAt,
  });

  return json({ success: true, recordUri });
}

async function routeApiRequest(
  request: Request,
  url: URL,
  originalFetch: typeof fetch,
): Promise<Response | null> {
  const pathParts = parsePathname(url.pathname);
  if (pathParts.length < 2 || pathParts[0] !== "api") return null;

  if (pathParts[1] === "articles") {
    return handleArticlesPath(request, url, pathParts, originalFetch);
  }
  if (pathParts[1] === "drafts") {
    return handleDraftsPath(request, url, pathParts);
  }
  if (pathParts[1] === "bsky" && pathParts[2] === "engagement") {
    if (request.method !== "POST") return null;
    return handleEngagement(request);
  }
  if (pathParts[1] === "workspace" && pathParts[2] === "sync-articles") {
    if (request.method !== "POST") return null;
    const force = url.searchParams.get("force") === "true";
    return syncLegacyArticles(force);
  }
  if (pathParts[1] === "workspace" && pathParts[2] === "files") {
    return handleWorkspaceFilesPath(request, pathParts);
  }
  if (
    pathParts[1] === "workspace" &&
    pathParts[2] === "import" &&
    pathParts[3] === "resolve"
  ) {
    if (request.method !== "POST") return null;
    return handleWorkspaceImportResolve(request);
  }
  return null;
}

export async function handleClientApiRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  originalFetch: typeof fetch,
): Promise<Response | null> {
  let request: Request;
  let url: URL;

  if (typeof input === "string" || input instanceof URL) {
    request = new Request(input, init);
    url = new URL(request.url, window.location.origin);
  } else {
    const inputRequest = input as Request;
    url = new URL(inputRequest.url, window.location.origin);

    if (inputRequest.bodyUsed) {
      return null;
    }

    try {
      const base = inputRequest.clone();
      request = init ? new Request(base, init) : base;
    } catch {
      return null;
    }
  }

  if (url.origin !== window.location.origin) return null;

  try {
    return await routeApiRequest(request, url, originalFetch);
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ error: error.message }, error.status);
    }
    console.error("Client API error:", error);
    return json(
      { error: error instanceof Error ? error.message : "Internal error" },
      500,
    );
  }
}

export async function createBootstrapArticleFromRecord(input: {
  uri: string;
  authorDid: string;
  title: string;
  authors?: ArticleAuthor[];
  sourceFormat: SourceFormat;
  blocks: ArticleBlock[];
  bibliography?: unknown;
  createdAt: string;
  announcementUri?: string | null;
  announcementCid?: string | null;
}): Promise<void> {
  if (!input.uri.startsWith(`at://`) || !input.uri.includes(`/${ARTICLE_COLLECTION}/`)) {
    return;
  }
  await upsertArticle({
    uri: input.uri,
    authorDid: input.authorDid,
    title: input.title,
    authorsJson: JSON.stringify(input.authors ?? []),
    blocksJson: serializeBlocks(input.blocks),
    bibliographyJson: serializeBibliography(normalizeBibliography(input.bibliography)),
    sourceFormat: input.sourceFormat,
    broadcasted: input.announcementUri ? 1 : 0,
    createdAt: input.createdAt,
    indexedAt: new Date().toISOString(),
  });
  if (input.announcementUri && input.announcementCid) {
    await upsertArticleAnnouncement({
      articleUri: input.uri,
      announcementUri: input.announcementUri,
      announcementCid: input.announcementCid,
      authorDid: input.authorDid,
      createdAt: input.createdAt,
    });
  }
  const handle = await getAccountHandle(input.authorDid);
  if (!handle) {
    await upsertAccount({
      did: input.authorDid,
      handle: input.authorDid,
      active: 1,
    });
  }
}
