import { NextRequest, NextResponse } from "next/server";

import { buildArticleUri, decodeRouteParam, extractQuoteFromExternalUri } from "@/lib/articles/uri";
import { getOAuthClient } from "@/lib/auth/client";
import { getSession } from "@/lib/auth/session";
import {
  getAnnouncementByArticleUri,
  getInlineCommentsByArticle,
  listBskyInteractionsBySubjects,
} from "@/lib/db/queries";

interface RootDiscussionPost {
  uri: string;
  cid: string;
  text: string;
}

type DiscussionSource = "tap" | "live" | "merged";

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
  source: DiscussionSource;
}

interface LiveThreadResult {
  root: RootDiscussionPost | null;
  posts: DiscussionItem[];
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
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

async function fetchThreadViaOAuth(announcementUri: string, did: string) {
  const oauthClient = await getOAuthClient();
  const oauthSession = await oauthClient.restore(did);
  const query = new URLSearchParams({
    uri: announcementUri,
    depth: "6",
    parentHeight: "0",
  });

  const response = await oauthSession.fetchHandler(
    `/xrpc/app.bsky.feed.getPostThread?${query.toString()}`,
  );
  if (!response.ok) return null;
  return (await response.json()) as unknown;
}

async function fetchThreadViaPublicApi(announcementUri: string) {
  const query = new URLSearchParams({
    uri: announcementUri,
    depth: "6",
    parentHeight: "0",
  });

  const response = await fetch(
    `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?${query.toString()}`,
    { cache: "no-store" },
  );
  if (!response.ok) return null;
  return (await response.json()) as unknown;
}

async function getLiveThread(announcementUri: string, sessionDid: string | null): Promise<LiveThreadResult> {
  let payload: unknown = null;

  if (sessionDid) {
    try {
      payload = await fetchThreadViaOAuth(announcementUri, sessionDid);
    } catch {
      payload = null;
    }
  }

  if (!payload) {
    try {
      payload = await fetchThreadViaPublicApi(announcementUri);
    } catch {
      payload = null;
    }
  }

  const thread = asObject(payload)?.thread;
  const flattened: DiscussionItem[] = [];
  flattenLiveReplies(thread, 0, null, flattened);

  if (flattened.length === 0) {
    return { root: null, posts: [] };
  }

  const [root, ...posts] = flattened;
  return {
    root: {
      uri: root.uri,
      cid: root.cid ?? "",
      text: root.text || "Announcement post",
    },
    posts,
  };
}

function quotedMatches(quoteFilter: string, quote: string): boolean {
  if (!quoteFilter) return false;
  return quote.toLowerCase().includes(quoteFilter.toLowerCase());
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ did: string; rkey: string }> },
) {
  const { did: didParam, rkey: rkeyParam } = await context.params;
  const did = decodeRouteParam(didParam);
  const rkey = decodeRouteParam(rkeyParam);
  const articleUri = buildArticleUri(did, rkey);
  const quoteFilter = normalizeQuote(request.nextUrl.searchParams.get("quote") ?? "");

  const [session, announcement, dbComments] = await Promise.all([
    getSession(),
    getAnnouncementByArticleUri(articleUri),
    getInlineCommentsByArticle(articleUri),
  ]);

  if (!announcement) {
    return NextResponse.json({ success: true, root: null, thread: [] });
  }

  const live = await getLiveThread(announcement.announcementUri, session?.did ?? null);

  const merged = new Map<string, DiscussionItem>();
  const liveOrder = new Map<string, number>();

  for (const [index, post] of live.posts.entries()) {
    liveOrder.set(post.uri, index);
    merged.set(post.uri, post);
  }

  for (const comment of dbComments) {
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

  const mergedThread = Array.from(merged.values()).sort((a, b) => {
    const ai = liveOrder.get(a.uri);
    const bi = liveOrder.get(b.uri);

    if (ai !== undefined && bi !== undefined) {
      return ai - bi;
    }

    if (ai !== undefined) return -1;
    if (bi !== undefined) return 1;

    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  const subjectUris = [
    announcement.announcementUri,
    ...mergedThread.map((comment) => comment.uri),
  ];
  const uniqueSubjectUris = Array.from(new Set(subjectUris));

  const interactions = session?.did
    ? await listBskyInteractionsBySubjects(uniqueSubjectUris, session.did)
    : [];
  const interactionSet = new Set(interactions.map((item) => `${item.action}:${item.subjectUri}`));

  const root: RootDiscussionPost = live.root ?? {
    uri: announcement.announcementUri,
    cid: announcement.announcementCid,
    text: "Announcement post",
  };

  return NextResponse.json({
    success: true,
    root,
    thread: mergedThread.map((post) => ({
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
      quoted: quotedMatches(quoteFilter, post.quote),
      liked: interactionSet.has(`like:${post.uri}`),
      reposted: interactionSet.has(`repost:${post.uri}`),
    })),
  });
}
