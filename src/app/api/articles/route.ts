import { Client } from "@atproto/lex";
import { AtUri } from "@atproto/syntax";
import { NextRequest, NextResponse } from "next/server";

import * as sci from "@/lexicons/sci";
import {
  normalizeBlocks,
  parseMarkdownToBlocks,
  parseTexToBlocks,
  serializeBlocks,
} from "@/lib/articles/blocks";
import { buildAtprotoAtArticleUrl } from "@/lib/articles/uri";
import { getOAuthClient } from "@/lib/auth/client";
import { getSession } from "@/lib/auth/session";
import type { SourceFormat } from "@/lib/db";
import {
  getRecentArticles,
  upsertArticle,
  upsertArticleAnnouncement,
} from "@/lib/db/queries";

const MAX_TITLE_LENGTH = 300;

interface CreateArticleRequest {
  title?: unknown;
  sourceFormat?: unknown;
  broadcastToBsky?: unknown;
  markdown?: unknown;
  tex?: unknown;
  resolvedMarkdown?: unknown;
  resolvedTex?: unknown;
  blocks?: unknown;
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const articles = await getRecentArticles(100, q);
  return NextResponse.json({ success: true, articles });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: CreateArticleRequest;
  try {
    body = (await request.json()) as CreateArticleRequest;
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
  const broadcastToBsky = body.broadcastToBsky === true;

  const textInput =
    sourceFormat === "tex"
      ? typeof body.resolvedTex === "string"
        ? body.resolvedTex
        : typeof body.tex === "string"
          ? body.tex
          : ""
      : typeof body.resolvedMarkdown === "string"
        ? body.resolvedMarkdown
        : typeof body.markdown === "string"
          ? body.markdown
          : "";

  const blocks =
    body.blocks !== undefined
      ? normalizeBlocks(body.blocks)
      : textInput
        ? sourceFormat === "tex"
          ? parseTexToBlocks(textInput)
          : parseMarkdownToBlocks(textInput)
        : [];

  if (blocks.length === 0) {
    return NextResponse.json(
      {
        error:
          "At least one section is required. Provide markdown with headings or blocks.",
      },
      { status: 400 },
    );
  }

  const oauthClient = await getOAuthClient();
  const oauthSession = await oauthClient.restore(session.did);
  const lexClient = new Client(oauthSession);

  const createdAt = new Date().toISOString();

  const article = await lexClient.create(sci.peer.article.main, {
    title,
    blocks,
    createdAt,
  });

  const articleUri = new AtUri(article.uri);
  const atprotoAtUrl = buildAtprotoAtArticleUrl(session.did, articleUri.rkey);

  let announcement: { uri: string; cid: string } | null = null;
  if (broadcastToBsky) {
    const announcementText = `新しい論文/実験計画を公開しました：『${title}』 ${atprotoAtUrl}`;

    const createdAnnouncement = await lexClient.createRecord({
      $type: "app.bsky.feed.post",
      text: announcementText,
      createdAt,
      embed: {
        $type: "app.bsky.embed.external",
        external: {
          uri: atprotoAtUrl,
          title,
          description: "ScholarViewで論文を公開しました",
        },
      },
    });

    announcement = {
      uri: createdAnnouncement.body.uri,
      cid: createdAnnouncement.body.cid,
    };
  }

  await upsertArticle({
    uri: article.uri,
    authorDid: session.did,
    title,
    blocksJson: serializeBlocks(blocks),
    sourceFormat,
    broadcasted: broadcastToBsky ? 1 : 0,
    createdAt,
    indexedAt: createdAt,
  });

  if (announcement) {
    await upsertArticleAnnouncement({
      articleUri: article.uri,
      announcementUri: announcement.uri,
      announcementCid: announcement.cid,
      authorDid: session.did,
      createdAt,
    });
  }

  return NextResponse.json({
    success: true,
    articleUri: article.uri,
    ...(announcement
      ? {
          announcementUri: announcement.uri,
          announcementCid: announcement.cid,
        }
      : {}),
    did: session.did,
    rkey: articleUri.rkey,
  });
}
