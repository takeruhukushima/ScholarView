import { Client } from "@atproto/lex";
import { AtUri } from "@atproto/syntax";
import { NextRequest, NextResponse } from "next/server";

import * as sci from "@/lexicons/sci";
import { parseMarkdownToBlocks, normalizeBlocks, serializeBlocks } from "@/lib/articles/blocks";
import { buildPaperUrl } from "@/lib/articles/uri";
import { getOAuthClient } from "@/lib/auth/client";
import { getSession } from "@/lib/auth/session";
import { upsertArticle, upsertArticleAnnouncement } from "@/lib/db/queries";

const PUBLIC_URL = process.env.PUBLIC_URL || "http://127.0.0.1:3000";
const MAX_TITLE_LENGTH = 300;

interface CreateArticleRequest {
  title?: unknown;
  markdown?: unknown;
  blocks?: unknown;
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

  const blocks =
    body.blocks !== undefined
      ? normalizeBlocks(body.blocks)
      : typeof body.markdown === "string"
        ? parseMarkdownToBlocks(body.markdown)
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
  const paperUrl = buildPaperUrl(PUBLIC_URL, session.did, articleUri.rkey);

  const announcementText = `新しい論文/実験計画を公開しました：『${title}』 ${paperUrl}`;

  const announcement = await lexClient.createRecord({
    $type: "app.bsky.feed.post",
    text: announcementText,
    createdAt,
    embed: {
      $type: "app.bsky.embed.external",
      external: {
        uri: paperUrl,
        title,
        description: "ScholarViewで論文を公開しました",
      },
    },
  });

  await upsertArticle({
    uri: article.uri,
    authorDid: session.did,
    title,
    blocksJson: serializeBlocks(blocks),
    createdAt,
    indexedAt: createdAt,
  });

  await upsertArticleAnnouncement({
    articleUri: article.uri,
    announcementUri: announcement.body.uri,
    announcementCid: announcement.body.cid,
    authorDid: session.did,
    createdAt,
  });

  return NextResponse.json({
    success: true,
    articleUri: article.uri,
    announcementUri: announcement.body.uri,
    announcementCid: announcement.body.cid,
    did: session.did,
    rkey: articleUri.rkey,
  });
}
