import { Client } from "@atproto/lex";
import { AtUri } from "@atproto/syntax";
import { NextRequest, NextResponse } from "next/server";

import * as sci from "@/lexicons/sci";
import {
  parseMarkdownToBlocks,
  parseTexToBlocks,
  serializeBlocks,
} from "@/lib/articles/blocks";
import {
  compactBibliography,
  normalizeBibliography,
  serializeBibliography,
} from "@/lib/articles/citations";
import { buildAtprotoAtArticleUrl, decodeRouteParam } from "@/lib/articles/uri";
import { getOAuthClient } from "@/lib/auth/client";
import { getSession } from "@/lib/auth/session";
import type { SourceFormat } from "@/lib/db";
import {
  deleteAnnouncementByUri,
  getAnnouncementByArticleUri,
  getArticleByDidAndRkey,
  getWorkspaceFileById,
  updateArticleByUri,
  updateWorkspaceFileById,
  upsertArticle,
  upsertArticleAnnouncement,
} from "@/lib/db/queries";
import { resolveWorkspaceImports } from "@/lib/workspace/imports";

const MAX_TITLE_LENGTH = 300;

interface PublishFileRequest {
  title?: unknown;
  broadcastToBsky?: unknown;
  bibliography?: unknown;
}

function normalizeTitle(input: unknown, fileName: string): string {
  if (typeof input === "string" && input.trim()) {
    return input.trim();
  }

  const noExt = fileName.replace(/\.[^.]+$/, "");
  return noExt.trim() || "Untitled";
}

function getBlocks(sourceFormat: SourceFormat, text: string) {
  return sourceFormat === "tex" ? parseTexToBlocks(text) : parseMarkdownToBlocks(text);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: rawId } = await context.params;
  const id = decodeRouteParam(rawId);

  const file = await getWorkspaceFileById(id, session.did);
  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
  if (file.kind !== "file") {
    return NextResponse.json({ error: "Only files can be published" }, { status: 400 });
  }

  let body: PublishFileRequest;
  try {
    body = (await request.json()) as PublishFileRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const title = normalizeTitle(body.title, file.name);
  if (title.length > MAX_TITLE_LENGTH) {
    return NextResponse.json(
      { error: `Title must be <= ${MAX_TITLE_LENGTH} characters` },
      { status: 400 },
    );
  }

  const broadcastToBsky = body.broadcastToBsky === true;
  const bibliographyInput =
    body.bibliography === undefined ? null : normalizeBibliography(body.bibliography);
  const sourceFormat: SourceFormat = file.sourceFormat === "tex" ? "tex" : "markdown";

  const rawText = file.content ?? "";
  const resolved = await resolveWorkspaceImports({
    text: rawText,
    sourceFormat,
    ownerDid: session.did,
  });
  const blocks = getBlocks(sourceFormat, resolved.resolvedText);

  if (blocks.length === 0) {
    return NextResponse.json(
      { error: "At least one section is required" },
      { status: 400 },
    );
  }

  const oauthClient = await getOAuthClient();
  const oauthSession = await oauthClient.restore(session.did);
  const lexClient = new Client(oauthSession);

  const now = new Date().toISOString();

  const linkedDid = file.linkedArticleDid;
  const linkedRkey = file.linkedArticleRkey;
  const existing =
    linkedDid && linkedRkey
      ? await getArticleByDidAndRkey(linkedDid, linkedRkey)
      : null;

  if (existing && existing.authorDid !== session.did) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let mode: "created" | "updated" = "created";
  let did: string;
  let rkey: string;
  let articleUri: string;
  let broadcasted: 0 | 1 = 0;

  if (existing) {
    const bibliography = bibliographyInput ?? existing.bibliography;
    const compactedBibliography = compactBibliography(bibliography);
    mode = "updated";
    did = existing.did;
    rkey = existing.rkey;
    articleUri = existing.uri;

    await lexClient.put(
      sci.peer.article.main,
      {
        title,
        blocks,
        bibliography: compactedBibliography,
        createdAt: new Date(existing.createdAt).toISOString(),
      },
      { rkey },
    );

    const announcement = await getAnnouncementByArticleUri(articleUri);
    let announcementUri: string | null = announcement?.announcementUri ?? null;

    if (broadcastToBsky && !announcement) {
      const atprotoAtUrl = buildAtprotoAtArticleUrl(did, rkey);
      const post = await lexClient.createRecord({
        $type: "app.bsky.feed.post",
        text: `更新した論文を公開しました：『${title}』 ${atprotoAtUrl}`,
        createdAt: now,
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
        createdAt: now,
      });
      announcementUri = post.body.uri;
      broadcasted = 1;
    } else if (!broadcastToBsky && announcement) {
      try {
        const announcementAtUri = new AtUri(announcement.announcementUri);
        await lexClient.deleteRecord("app.bsky.feed.post", announcementAtUri.rkey);
      } catch {
        // keep DB consistent
      }
      await deleteAnnouncementByUri(announcement.announcementUri);
      announcementUri = null;
      broadcasted = 0;
    } else {
      broadcasted = announcementUri ? 1 : 0;
    }

    await updateArticleByUri(articleUri, {
      title,
      blocksJson: serializeBlocks(blocks),
      bibliographyJson: serializeBibliography(compactedBibliography),
      sourceFormat,
      indexedAt: now,
      broadcasted,
    });
  } else {
    const bibliography = bibliographyInput ?? [];
    const compactedBibliography = compactBibliography(bibliography);
    mode = "created";
    did = session.did;

    const created = await lexClient.create(sci.peer.article.main, {
      title,
      blocks,
      bibliography: compactedBibliography,
      createdAt: now,
    });

    articleUri = created.uri;
    const atUri = new AtUri(created.uri);
    rkey = atUri.rkey;

    let announcement: { uri: string; cid: string } | null = null;
    if (broadcastToBsky) {
      const atprotoAtUrl = buildAtprotoAtArticleUrl(did, rkey);
      const post = await lexClient.createRecord({
        $type: "app.bsky.feed.post",
        text: `新しい論文/実験計画を公開しました：『${title}』 ${atprotoAtUrl}`,
        createdAt: now,
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
        uri: post.body.uri,
        cid: post.body.cid,
      };
    }

    await upsertArticle({
      uri: articleUri,
      authorDid: session.did,
      title,
      blocksJson: serializeBlocks(blocks),
      bibliographyJson: serializeBibliography(compactedBibliography),
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
        authorDid: session.did,
        createdAt: now,
      });
    }

    broadcasted = announcement ? 1 : 0;
  }

  const updatedFile = await updateWorkspaceFileById(id, session.did, {
    linkedArticleDid: did,
    linkedArticleRkey: rkey,
    linkedArticleUri: articleUri,
  });

  return NextResponse.json({
    success: true,
    mode,
    did,
    rkey,
    uri: articleUri,
    broadcasted,
    diagnostics: resolved.diagnostics,
    file: updatedFile,
  });
}
