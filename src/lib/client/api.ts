"use client";

import { serializeBlocks, type ArticleBlock } from "@/lib/articles/blocks";
import { normalizeBibliography, serializeBibliography } from "@/lib/articles/citations";
import { ARTICLE_COLLECTION } from "@/lib/articles/uri";
import {
  getAccountHandle,
  upsertAccount,
  upsertArticle,
  upsertArticleAnnouncement,
} from "@/lib/client/store";
import type { ArticleAuthor, SourceFormat } from "@/lib/types";
import {
  handleArticlesPath,
  HttpError,
  json,
} from "@/lib/client/api/articles";
import { handleDraftsPath } from "@/lib/client/api/drafts";
import { handleEngagement } from "@/lib/client/api/engagement";
import {
  handleWorkspaceFilesPath,
  handleWorkspaceImportResolve,
  syncLegacyArticles,
} from "@/lib/client/api/workspace";

function decodeParam(value: string): string {
  return decodeURIComponent(value);
}

function parsePathname(pathname: string): string[] {
  return pathname.split("/").filter(Boolean).map(decodeParam);
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
