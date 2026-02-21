import { Client } from "@atproto/lex";
import { AtUri } from "@atproto/syntax";
import { NextRequest, NextResponse } from "next/server";

import * as sci from "@/lexicons/sci";
import {
  buildArticleUri,
  buildAtprotoAtArticleUrl,
  decodeRouteParam,
} from "@/lib/articles/uri";
import {
  normalizeBlocks,
  parseMarkdownToBlocks,
  parseTexToBlocks,
  serializeBlocks,
} from "@/lib/articles/blocks";
import { getOAuthClient } from "@/lib/auth/client";
import { getSession } from "@/lib/auth/session";
import type { SourceFormat } from "@/lib/db";
import {
  deleteAnnouncementByUri,
  deleteArticleCascade,
  getAnnouncementByArticleUri,
  getArticleByDidAndRkey,
  getArticleOwnerDid,
  upsertArticleAnnouncement,
  updateArticleByUri,
} from "@/lib/db/queries";

const MAX_TITLE_LENGTH = 300;

interface UpdateArticleRequest {
  title?: unknown;
  sourceFormat?: unknown;
  markdown?: unknown;
  tex?: unknown;
  blocks?: unknown;
  broadcastToBsky?: unknown;
}

function getBlocks(input: UpdateArticleRequest, sourceFormat: SourceFormat) {
  if (input.blocks !== undefined) {
    return normalizeBlocks(input.blocks);
  }

  if (sourceFormat === "tex") {
    if (typeof input.tex !== "string") return [];
    return parseTexToBlocks(input.tex);
  }

  if (typeof input.markdown !== "string") return [];
  return parseMarkdownToBlocks(input.markdown);
}

export async function PUT(
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

  if (session.did !== did) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: UpdateArticleRequest;
  try {
    body = (await request.json()) as UpdateArticleRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return NextResponse.json(
      { error: `Title must be <= ${MAX_TITLE_LENGTH} characters` },
      { status: 400 },
    );
  }

  const sourceFormat: SourceFormat =
    body.sourceFormat === "tex" ? "tex" : "markdown";
  const blocks = getBlocks(body, sourceFormat);
  const broadcastToBsky = body.broadcastToBsky === true;

  if (blocks.length === 0) {
    return NextResponse.json(
      { error: "At least one section is required" },
      { status: 400 },
    );
  }

  const article = await getArticleByDidAndRkey(did, rkey);
  if (!article) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  const oauthClient = await getOAuthClient();
  const oauthSession = await oauthClient.restore(session.did);
  const lexClient = new Client(oauthSession);

  await lexClient.put(
    sci.peer.article.main,
    {
      title,
      blocks,
      createdAt: new Date(article.createdAt).toISOString(),
    },
    { rkey },
  );

  const indexedAt = new Date().toISOString();
  const articleUri = buildArticleUri(did, rkey);
  const announcement = await getAnnouncementByArticleUri(articleUri);
  let broadcasted: 0 | 1 = announcement ? 1 : 0;
  let announcementUri: string | null = announcement?.announcementUri ?? null;

  if (broadcastToBsky && !announcement) {
    const atprotoAtUrl = buildAtprotoAtArticleUrl(did, rkey);
    const post = await lexClient.createRecord({
      $type: "app.bsky.feed.post",
      text: `更新した論文を公開しました：『${title}』 ${atprotoAtUrl}`,
      createdAt: indexedAt,
      embed: {
        $type: "app.bsky.embed.external",
        external: {
          uri: atprotoAtUrl,
          title,
          description: "ScholarViewで論文を公開しました",
        },
      },
    });

    await upsertArticleAnnouncement({
      articleUri,
      announcementUri: post.body.uri,
      announcementCid: post.body.cid,
      authorDid: session.did,
      createdAt: indexedAt,
    });
    broadcasted = 1;
    announcementUri = post.body.uri;
  }

  if (!broadcastToBsky && announcement) {
    try {
      const announcementAtUri = new AtUri(announcement.announcementUri);
      await lexClient.deleteRecord("app.bsky.feed.post", announcementAtUri.rkey);
    } catch {
      // keep DB consistent even when remote post already deleted.
    }
    await deleteAnnouncementByUri(announcement.announcementUri);
    broadcasted = 0;
    announcementUri = null;
  }

  await updateArticleByUri(buildArticleUri(did, rkey), {
    title,
    blocksJson: serializeBlocks(blocks),
    sourceFormat,
    indexedAt,
    broadcasted,
  });

  return NextResponse.json({
    success: true,
    articleUri,
    announcementUri,
    broadcasted,
  });
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ did: string; rkey: string }> },
) {
  const { did: didParam, rkey: rkeyParam } = await context.params;
  const did = decodeRouteParam(didParam);
  const rkey = decodeRouteParam(rkeyParam);

  const article = await getArticleByDidAndRkey(did, rkey);
  if (!article) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true, article });
}

export async function DELETE(
  _request: NextRequest,
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

  const ownerDid = await getArticleOwnerDid(articleUri);
  if (!ownerDid) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  if (ownerDid !== session.did) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const oauthClient = await getOAuthClient();
  const oauthSession = await oauthClient.restore(session.did);
  const lexClient = new Client(oauthSession);

  await lexClient.delete(sci.peer.article.main, { rkey });

  const announcement = await deleteArticleCascade(articleUri);

  let deletedAnnouncement = false;
  if (announcement?.announcementUri) {
    try {
      const announcementAtUri = new AtUri(announcement.announcementUri);
      const announcementRkey = announcementAtUri.rkey;

      if (announcementRkey) {
        await lexClient.deleteRecord("app.bsky.feed.post", announcementRkey);
        deletedAnnouncement = true;
      }
    } catch {
      deletedAnnouncement = false;
    }
  }

  return NextResponse.json({
    success: true,
    deleted: {
      article: true,
      announcement: deletedAnnouncement,
    },
  });
}
