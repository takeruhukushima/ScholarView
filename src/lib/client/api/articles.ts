"use client";

import { Client } from "@atproto/lex";
import { AtUri } from "@atproto/syntax";

import * as sci from "@/lexicons/sci";
import { GUEST_DID_PREFIX } from "@/lib/guest-identity";
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
  getPublicBaseUrl,
} from "@/lib/articles/uri";
import {
  getActiveDid,
  getActiveHandle,
  getLexClientForCurrentSession,
  getSessionFetchHandler,
} from "@/lib/auth/browser";
import {
  deleteAnnouncementByUri,
  deleteArticleCascade,
  getAnnouncementByArticleUri,
  getArticleByDidAndRkey,
  getArticleOwnerDid,
  getInlineCommentsByArticle,
  getRecentArticles,
  getWorkspaceFileByPath,
  listBskyInteractionsBySubjects,
  listWorkspaceFiles,
  updateArticleByUri,
  updateWorkspaceFileById,
  upsertAccount,
  upsertArticle,
  upsertArticleAnnouncement,
  upsertInlineComment,
} from "@/lib/client/store";
import type {
  ArticleAuthor,
  ArticleDetail,
  ArticleImageAsset,
  ArticleSummary,
  SourceFormat,
  WorkspaceFileNode,
} from "@/lib/types";
import { writeGuestRecord, getGuestCommentsForArticle, getRecentGuestArticles } from "@/lib/firebase-client";

export const MAX_TITLE_LENGTH = 300;
export const MAX_COMMENT_LENGTH = 2_000;
export const MAX_QUOTE_LENGTH = 280;
export const MAX_DRAFT_CONTENT_LENGTH = 60_000;
const OWN_ARTICLE_SYNC_INTERVAL_MS = 30_000;

const ownArticleSyncInFlight = new Map<string, Promise<void>>();
const ownArticleSyncedAt = new Map<string, number>();

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

export function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function safeTimestampMs(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function sourceFormatFromUnknown(value: unknown): SourceFormat {
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

export async function buildWorkspaceArticleImageAssets(
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

export async function triggerRelayCrawl(repo?: string) {
  try {
    await fetch("/api/atproto/sync/request-crawl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo }),
    });
  } catch (e) {
    console.error("Failed to trigger relay crawl:", e);
  }
}

export async function syncOwnArticlesFromRepo(options?: { force?: boolean }): Promise<void> {
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

export async function requireDid(): Promise<string> {
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

export async function getDidOrLocal(): Promise<string> {
  const did = await getActiveDid();
  if (did) {
    if (!did.startsWith(GUEST_DID_PREFIX)) {
      const handle = await getActiveHandle();
      if (handle) {
        await upsertAccount({
          did,
          handle,
          active: 1,
        });
      }
    }
    return did;
  }
  return "local";
}

export async function getAuthedLexClient(): Promise<{ did: string; lex: Client }> {
  const did = await requireDid();
  const lex = await getLexClientForCurrentSession();
  return { did, lex };
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
      if (postAuthorDid === authorDid) {
        const uri = asString(post.uri);
        const cid = asString(post.cid);
        const record = asObject(post.record);
        const createdAt = asString(record?.createdAt) || new Date().toISOString();
        if (uri && cid) authorPosts.push({ uri, cid, createdAt });
      }

      const replies = Array.isArray(asObject(node)?.replies) ? asObject(node)?.replies : [];
      for (const reply of replies as unknown[]) traverse(reply);
    };

    traverse(thread);
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
  };
}

async function resolvePdsEndpoint(did: string): Promise<string | null> {
  if (did.startsWith(GUEST_DID_PREFIX)) {
    return typeof window !== "undefined" ? window.location.origin : getPublicBaseUrl();
  }
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

export async function normalizeAnnouncementRootWithPublicApi(
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

export async function normalizeAnnouncementRootWithLex(
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

export async function discoverAnnouncement(
  did: string,
  rkey: string,
  originalFetch: typeof fetch,
): Promise<{ uri: string; cid: string } | null> {
  // Guest DIDs are not indexed by the public Bluesky relay/AppView
  if (did.startsWith(GUEST_DID_PREFIX)) return null;

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

  // Fallback 1: Public AT Protocol Relay or Local Guest XRPC
  if (!article) {
    if (did.startsWith(GUEST_DID_PREFIX)) {
      try {
        const query = new URLSearchParams({
          repo: did,
          collection: ARTICLE_COLLECTION,
          rkey,
        });
        const res = await originalFetch(`/xrpc/com.atproto.repo.getRecord?${query.toString()}`, { cache: "no-store" });
        if (res.ok) {
          const payload = (await res.json()) as { value?: Record<string, unknown>; uri?: string };
          if (payload.value) {
            article = transformRecordToArticleDetail(did, rkey, payload.value);
          }
        }
      } catch (err) {
        console.error("Failed to fetch guest article from local XRPC:", err);
      }
    } else {
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
    if (did.startsWith(GUEST_DID_PREFIX)) {
      // For guests, we can check if there's a local announcement record
      const localAnnouncement = await getAnnouncementByArticleUri(article.uri);
      if (localAnnouncement) {
        article.announcementUri = localAnnouncement.announcementUri;
        article.announcementCid = localAnnouncement.announcementCid;
      }
    } else {
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
  }

  return json({ success: true, article });
}

async function deleteArticle(did: string, rkey: string): Promise<Response> {
  const { did: sessionDid, lex } = await getAuthedLexClient();
  const articleUri = buildArticleUri(did, rkey);
  const ownerDid = await getArticleOwnerDid(articleUri);
  if (!ownerDid) throw new HttpError(404, "Article not found");
  if (ownerDid !== sessionDid) throw new HttpError(403, "Forbidden");

  let deletedArticleAtproto = false;
  try {
    await lex.deleteRecord(ARTICLE_COLLECTION, rkey);
    deletedArticleAtproto = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    // Remote already gone: proceed with local cleanup.
    if (!/record not found|could not locate record|not found/i.test(message)) {
      throw error;
    }
  }

  const announcement = await deleteArticleCascade(articleUri);
  const workspaceFiles = await listWorkspaceFiles(sessionDid);
  const linkedFiles = workspaceFiles.filter((file) => file.linkedArticleUri === articleUri);
  for (const file of linkedFiles) {
    await updateWorkspaceFileById(file.id, sessionDid, {
      linkedArticleDid: null,
      linkedArticleRkey: null,
      linkedArticleUri: null,
    });
  }

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
    articleUri,
    unlinkedFileIds: linkedFiles.map((file) => file.id),
    deleted: {
      article: true,
      articleAtproto: deletedArticleAtproto,
      announcement: deletedAnnouncement,
    },
  });
}

async function createInlineComment(
  request: Request,
  did: string,
  rkey: string,
): Promise<Response> {
  const isGuest = did.startsWith(GUEST_DID_PREFIX);
  const lex = !isGuest ? await getLexClientForCurrentSession() : null;
  const articleUri = buildArticleUri(did, rkey);
  const announcement = await getAnnouncementByArticleUri(articleUri);
  if (!isGuest && !announcement) {
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

  let commentUri = "";

  if (lex && !isGuest && announcement) {
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
    commentUri = created.body.uri;
  } else if (isGuest && announcement) {
    // Guest local comment - also push to Firestore
    const localRkey = Math.random().toString(36).substring(2, 12);
    commentUri = `at://${did}/app.bsky.feed.post/${localRkey}`;
    
    const commentValue = {
      $type: "app.bsky.feed.post",
      text,
      createdAt,
      reply: {
        root: {
          uri: announcement.announcementUri,
          cid: announcement.announcementCid || "local-guest-cid",
        },
        parent: {
          uri: announcement.announcementUri,
          cid: announcement.announcementCid || "local-guest-cid",
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
    };
    
    await writeGuestRecord(did, "app.bsky.feed.post", localRkey, commentValue, createdAt).catch(e => console.error("Failed to write guest comment to Firestore:", e));
    void triggerRelayCrawl(did);
  } else {
    throw new HttpError(400, "Cannot post comment without announcement or valid session");
  }

  await upsertInlineComment({
    uri: commentUri,
    articleUri,
    authorDid: did,
    text,
    quote: normalizedQuote,
    externalUri,
    createdAt,
    indexedAt: createdAt,
  });

  return json({ success: true, commentUri });
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

  // Guest DIDs are not indexed by public relays, skip normalization and external thread fetch
  const isGuestArticle = did.startsWith(GUEST_DID_PREFIX);

  if (!isGuestArticle) {
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
  }

  let payload: unknown = null;
  if (sessionDid && !isGuestArticle) {
    try {
      payload = await fetchThreadViaOAuth(announcement.announcementUri);
    } catch {
      payload = null;
    }
  }
  if (!payload && !isGuestArticle) {
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

  // Fetch guest comments from Firestore
  let globalGuestComments: Array<{
    uri: string;
    authorDid: string;
    text: string;
    quote: string;
    externalUri: string;
    createdAt: string;
  }> = [];
  try {
    const fsComments = await getGuestCommentsForArticle(announcement.announcementUri);
    globalGuestComments = fsComments.map(doc => {
      const v = doc.value as Record<string, unknown>;
      const embed = (v.embed as Record<string, unknown> | undefined)?.external as Record<string, unknown> | undefined;
      return {
        uri: doc.uri,
        authorDid: doc.repo,
        text: (v.text as string) || "",
        quote: (embed?.description as string) || "",
        externalUri: (embed?.uri as string) || "",
        createdAt: doc.createdAt
      };
    });
  } catch (e) {
    console.error("Failed to fetch global guest comments:", e);
  }

  // Combine local and global guest comments
  const allGuestComments = [...localComments, ...globalGuestComments];

  for (const comment of allGuestComments) {
    const existing = merged.get(comment.uri);
    if (existing) {
      merged.set(comment.uri, {
        ...existing,
        handle: (comment as { handle?: string }).handle ?? existing.handle,
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
      handle: (comment as { handle?: string }).handle || "guest.local",
      authorDid: comment.authorDid,
      text: comment.text,
      quote: comment.quote,
      externalUri: comment.externalUri,
      createdAt: comment.createdAt,
      parentUri: announcement.announcementUri,
      depth: 1,
      source: "tap", // treat as external/local hybrid
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

export async function handleArticlesPath(
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
      let articles = await getRecentArticles(100, q);
      
      // Merge global guest articles from Firestore
      try {
        const guestArticles = await getRecentGuestArticles(20);
        const guestArticleSummaries = guestArticles.map(doc => {
          const v = doc.value as Record<string, unknown>;
          const uriParts = doc.uri.split('/');
          const rkey = uriParts[uriParts.length - 1];
          return {
            uri: doc.uri,
            did: doc.repo,
            rkey,
            authorDid: doc.repo,
            handle: "guest.local",
            title: (v.title as string) || "Untitled",
            authors: Array.isArray(v.authors) ? (v.authors as ArticleAuthor[]) : [],
            sourceFormat: "markdown", // default assumption for guest summaries
            broadcasted: 1,
            createdAt: doc.createdAt,
            announcementUri: null // Could be resolved if needed
          } as ArticleSummary;
        });
        
        // Filter out duplicates (if we already have them in IndexedDB)
        const existingUris = new Set(articles.map(a => a.uri));
        const newGuestArticles = guestArticleSummaries.filter(a => !existingUris.has(a.uri));
        
        articles = [...articles, ...newGuestArticles]
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          
      } catch (e) {
        console.error("Failed to fetch global guest articles:", e);
      }

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
