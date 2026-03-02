"use client";

import { Client } from "@atproto/lex";
import { AtUri } from "@atproto/syntax";

import * as sci from "@/lexicons/sci";
import {
  normalizeBlocks,
  parseMarkdownToBlocks,
  parseTexToBlocks,
  serializeBlocks,
  type ArticleBlock,
} from "@/lib/articles/blocks";
import {
  compactBibliography,
  normalizeBibliography,
  serializeBibliography,
} from "@/lib/articles/citations";
import {
  ARTICLE_COLLECTION,
  buildArticleUri,
  buildScholarViewArticleUrl,
  extractQuoteFromExternalUri,
} from "@/lib/articles/uri";
import {
  getActiveDid,
  getActiveHandle,
  getLexClientForCurrentSession,
  getSessionFetchHandler,
} from "@/lib/auth/browser";
import {
  createWorkspaceFile,
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
  listBskyInteractionsBySubjects,
  listDrafts,
  listWorkspaceFiles,
  saveDraft,
  updateArticleByUri,
  updateWorkspaceFileById,
  upsertAccount,
  upsertArticle,
  upsertArticleAnnouncement,
  upsertBskyInteraction,
  upsertInlineComment,
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
): Promise<UploadedArticleImageAsset[]> {
  const allFiles = await listWorkspaceFiles(ownerDid);
  const sourcePath = buildWorkspaceFilePath(sourceFile, allFiles);
  const baseDir = sourcePath ? dirname(sourcePath) : "/";
  const refs = collectImageRefsFromBlocks(blocks, sourceFormat);
  if (refs.length === 0) return [];

  const assetsByPath = new Map<string, UploadedArticleImageAsset>();
  for (const ref of refs) {
    const path =
      resolveWorkspaceIdRefToPath(ref.src, allFiles) ??
      resolveImageRefToWorkspacePath(ref.src, baseDir);
    if (!path || assetsByPath.has(path)) continue;

    const imageFile = await getWorkspaceFileByPath(path, ownerDid);
    if (!imageFile || imageFile.kind !== "file") continue;

    const raw = typeof imageFile.content === "string" ? imageFile.content : "";
    const decoded = decodeDataUrlToBytes(raw);
    if (!decoded) continue;

    const blob = await uploadBlobForCurrentSession(lex, decoded.mimeType, decoded.bytes);
    const alt = ref.alt.trim();
    assetsByPath.set(path, alt ? { path, alt, blob } : { path, blob });
  }

  return [...assetsByPath.values()];
}

function parseArticleValue(value: unknown): {
  title: string;
  authors: ArticleAuthor[];
  blocks: ArticleBlock[];
  bibliography: ReturnType<typeof normalizeBibliography>;
  images: ArticleImageAsset[];
  createdAt: string;
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

  const bibliography =
    body.bibliography === undefined
      ? current.bibliography
      : compactBibliography(normalizeBibliography(body.bibliography));
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
  const announcement = await getAnnouncementByArticleUri(articleUri);
  let announcementUri = announcement?.announcementUri ?? null;
  let broadcasted: 0 | 1 = announcement ? 1 : 0;
  const forceBroadcast = customBroadcastText !== null;

  if (broadcastToBsky && (!announcement || forceBroadcast)) {
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

    await upsertArticleAnnouncement({
      articleUri,
      announcementUri: post.body.uri,
      announcementCid: post.body.cid,
      authorDid: did,
      createdAt: now,
    });
    announcementUri = post.body.uri;
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

async function discoverAnnouncement(
  did: string,
  rkey: string,
  originalFetch: typeof fetch,
): Promise<{ uri: string; cid: string } | null> {
  const articleUrl = buildScholarViewArticleUrl(did, rkey);
  try {
    const query = new URLSearchParams({
      actor: did,
      limit: "30",
    });
    // Search the author's feed for a post that embeds this article's URL
    const res = await originalFetch(
      `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?${query.toString()}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;

    const payload = (await res.json()) as { feed?: unknown[] };
    const feed = Array.isArray(payload.feed) ? payload.feed : [];

    for (const item of feed) {
      const itemObj = asObject(item);
      const post = asObject(itemObj?.post);
      if (!post) continue;

      const record = asObject(post.record);
      const embed = asObject(record?.embed);

      // Check for external embed in the post record
      if (
        embed &&
        (embed["$type"] === "app.bsky.embed.external" ||
          embed["$type"] === "app.bsky.embed.external#view")
      ) {
        const external = asObject(embed.external);
        const externalUri = asString(external?.uri);
        
        // Match canonical URL (ignoring quote params if necessary, but broadcast uses exact match)
        if (externalUri === articleUrl || externalUri.split("?")[0] === articleUrl.split("?")[0]) {
          return {
            uri: asString(post.uri),
            cid: asString(post.cid),
          };
        }
      }
    }
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

async function deleteArticle(did: string, rkey: string): Promise<Response> {
  const { did: sessionDid, lex } = await getAuthedLexClient();
  const articleUri = buildArticleUri(did, rkey);
  const ownerDid = await getArticleOwnerDid(articleUri);
  if (!ownerDid) throw new HttpError(404, "Article not found");
  if (ownerDid !== sessionDid) throw new HttpError(403, "Forbidden");

  await lex.delete(sci.peer.article.main, { rkey });
  const announcement = await deleteArticleCascade(articleUri);

  let deletedAnnouncement = false;
  if (announcement?.announcementUri) {
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
    createdAt: asString(post.indexedAt) || new Date().toISOString(),
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

async function syncLegacyArticles(force = false): Promise<Response> {
  await syncOwnArticlesFromRepo({ force });
  const did = await requireDid();
  const [allArticles, existingFiles] = await Promise.all([
    getRecentArticles(500),
    listWorkspaceFiles(did),
  ]);
  const myArticles = allArticles.filter((article) => article.authorDid === did);
  const existingNames = new Set(existingFiles.map((file) => file.name.toLowerCase()));

  let created = 0;
  for (const article of myArticles) {
    const existingLinked = await getWorkspaceFileByLinkedArticleUri(article.uri, did);
    if (existingLinked) {
      if (force) {
        const detail = await getArticleByDidAndRkey(article.did, article.rkey);
        if (detail) {
          const sourceFormat = detail.sourceFormat === "tex" ? "tex" : "markdown";
          const content = blocksToSource(detail.blocks, sourceFormat);
          await updateWorkspaceFileById(existingLinked.id, did, {
            content,
            sourceFormat,
            linkedArticleDid: article.did,
            linkedArticleRkey: article.rkey,
            linkedArticleUri: article.uri,
          });
        }
      }
      continue;
    }

    const detail = await getArticleByDidAndRkey(article.did, article.rkey);
    if (!detail) continue;

    const sourceFormat = detail.sourceFormat === "tex" ? "tex" : "markdown";
    const content = blocksToSource(detail.blocks, sourceFormat);
    const name = uniqueFileName(detail.title, sourceFormat, existingNames, article.rkey);

    const file = await createWorkspaceFile({
      ownerDid: did,
      parentId: null,
      name,
      kind: "file",
      sourceFormat,
      content,
    });

    await updateWorkspaceFileById(file.id, did, {
      linkedArticleDid: article.did,
      linkedArticleRkey: article.rkey,
      linkedArticleUri: article.uri,
    });

    created += 1;
  }

  const files = await listWorkspaceFiles(did);
  return json({ success: true, created, files });
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
        const existing = await getWorkspaceFileById(id, did);
        if (!existing) throw new HttpError(404, "file not found");
        await deleteWorkspaceFileById(id, did);
        return json({ success: true });
      }
      return null;
    }

    if (pathParts.length === 5 && pathParts[4] === "publish") {
      if (request.method !== "POST") return null;
      return publishWorkspaceFile(request, id, did);
    }
  }

  return null;
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
    broadcastText?: unknown;
    bibliography?: unknown;
  };

  const customBroadcastText = typeof body.broadcastText === "string" ? body.broadcastText : null;

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
  const imageAssets = await buildWorkspaceArticleImageAssets(lex, blocks, sourceFormat, did, file);

  const bibliographyInput =
    body.bibliography === undefined ? null : normalizeBibliography(body.bibliography);
  const now = new Date().toISOString();
  const linkedDid = file.linkedArticleDid;
  const linkedRkey = file.linkedArticleRkey;
  const existing =
    linkedDid && linkedRkey ? await getArticleByDidAndRkey(linkedDid, linkedRkey) : null;

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

    const bibliography = compactBibliography(
      bibliographyInput ?? existing.bibliography,
    );

    await lex.put(
      sci.peer.article.main,
      {
        title,
        authors,
        blocks,
        bibliography,
        images: imageAssets as unknown as sci.peer.article.ImageAsset[],
        createdAt: new Date(existing.createdAt).toISOString(),
      },
      { rkey: targetRkey },
    );

    const announcement = await getAnnouncementByArticleUri(articleUri);
    const forceBroadcast = customBroadcastText !== null;

    if (body.broadcastToBsky === true && (!announcement || forceBroadcast)) {
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
      await upsertArticleAnnouncement({
        articleUri,
        announcementUri: post.body.uri,
        announcementCid: post.body.cid,
        authorDid: did,
        createdAt: now,
      });
      broadcasted = 1;
    } else if (body.broadcastToBsky !== true && announcement) {
      try {
        const at = new AtUri(announcement.announcementUri);
        await lex.deleteRecord("app.bsky.feed.post", at.rkey);
      } catch {
        // noop
      }
      await deleteAnnouncementByUri(announcement.announcementUri);
      broadcasted = 0;
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
      createdAt: now,
    });

    const atUri = new AtUri(created.uri);

    targetDid = did;
    targetRkey = atUri.rkey;
    articleUri = created.uri;

    let announcement: { uri: string; cid: string } | null = null;
    if (body.broadcastToBsky === true) {
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

  const updatedFile = await updateWorkspaceFileById(fileId, did, {
    linkedArticleDid: targetDid,
    linkedArticleRkey: targetRkey,
    linkedArticleUri: articleUri,
  });

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
