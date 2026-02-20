import { Client } from "@atproto/lex";
import { NextRequest, NextResponse } from "next/server";

import { buildArticleUri, buildPaperUrl, decodeRouteParam } from "@/lib/articles/uri";
import { getOAuthClient } from "@/lib/auth/client";
import { getSession } from "@/lib/auth/session";
import {
  getAnnouncementByArticleUri,
  upsertInlineComment,
} from "@/lib/db/queries";

const PUBLIC_URL = process.env.PUBLIC_URL || "http://127.0.0.1:3000";
const MAX_QUOTE_LENGTH = 280;
const MAX_COMMENT_LENGTH = 2_000;

interface CreateInlineCommentRequest {
  text?: unknown;
  quote?: unknown;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ did: string; rkey: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { did: didParam, rkey: rkeyParam } = await context.params;
  const did = decodeRouteParam(didParam);
  const rkey = decodeRouteParam(rkeyParam);
  const articleUri = buildArticleUri(did, rkey);

  const announcement = await getAnnouncementByArticleUri(articleUri);
  if (!announcement) {
    return NextResponse.json(
      { error: "Announcement post not found for this article" },
      { status: 404 },
    );
  }

  let body: CreateInlineCommentRequest;
  try {
    body = (await request.json()) as CreateInlineCommentRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  const quote = typeof body.quote === "string" ? body.quote.trim() : "";

  if (!text) {
    return NextResponse.json({ error: "Comment text is required" }, { status: 400 });
  }
  if (text.length > MAX_COMMENT_LENGTH) {
    return NextResponse.json(
      { error: `Comment text must be <= ${MAX_COMMENT_LENGTH} characters` },
      { status: 400 },
    );
  }

  if (!quote) {
    return NextResponse.json({ error: "Quote is required" }, { status: 400 });
  }

  const normalizedQuote = quote.slice(0, MAX_QUOTE_LENGTH);

  const oauthClient = await getOAuthClient();
  const oauthSession = await oauthClient.restore(session.did);
  const lexClient = new Client(oauthSession);

  const createdAt = new Date().toISOString();
  const externalUri = buildPaperUrl(PUBLIC_URL, did, rkey, normalizedQuote);

  const created = await lexClient.createRecord({
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
    authorDid: session.did,
    text,
    quote: normalizedQuote,
    externalUri,
    createdAt,
    indexedAt: createdAt,
  });

  return NextResponse.json({
    success: true,
    commentUri: created.body.uri,
  });
}
