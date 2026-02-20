import { parseTapEvent, assureAdminAuth } from "@atproto/tap";
import { AtUri } from "@atproto/syntax";
import { NextRequest, NextResponse } from "next/server";

import * as sci from "@/lexicons/sci";
import { ARTICLE_COLLECTION, extractQuoteFromExternalUri } from "@/lib/articles/uri";
import { serializeBlocks } from "@/lib/articles/blocks";
import {
  deleteAccount,
  deleteAnnouncementByUri,
  deleteArticleCascade,
  deleteInlineComment,
  getAnnouncementByUri,
  upsertAccount,
  upsertArticle,
  upsertInlineComment,
} from "@/lib/db/queries";

const TAP_ADMIN_PASSWORD = process.env.TAP_ADMIN_PASSWORD;

interface ParsedInlineCommentRecord {
  text: string;
  createdAt: string;
  rootUri: string;
  externalUri: string;
  quote: string;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function parseInlineCommentRecord(record: unknown): ParsedInlineCommentRecord | null {
  const obj = asObject(record);
  if (!obj || obj.$type !== "app.bsky.feed.post") return null;

  const text = typeof obj.text === "string" ? obj.text.trim() : "";
  if (!text) return null;
  if (text.length > 2_000) return null;

  const createdAt =
    typeof obj.createdAt === "string" && obj.createdAt
      ? obj.createdAt
      : new Date().toISOString();

  const reply = asObject(obj.reply);
  const root = reply ? asObject(reply.root) : null;
  const rootUri = root && typeof root.uri === "string" ? root.uri : null;
  if (!rootUri) return null;

  const embed = asObject(obj.embed);
  const external =
    embed && embed.$type === "app.bsky.embed.external"
      ? asObject(embed.external)
      : null;
  const externalUri =
    external && typeof external.uri === "string" ? external.uri : "";

  const quote = externalUri ? extractQuoteFromExternalUri(externalUri) ?? "" : "";

  return {
    text,
    createdAt,
    rootUri,
    externalUri,
    quote,
  };
}

export async function POST(request: NextRequest) {
  if (TAP_ADMIN_PASSWORD) {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      assureAdminAuth(TAP_ADMIN_PASSWORD, authHeader);
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const body = await request.json();
  const evt = parseTapEvent(body);

  if (evt.type === "identity") {
    if (evt.status === "deleted") {
      await deleteAccount(evt.did);
    } else {
      await upsertAccount({
        did: evt.did,
        handle: evt.handle,
        active: evt.isActive ? 1 : 0,
      });
    }

    return NextResponse.json({ success: true });
  }

  if (evt.type !== "record") {
    return NextResponse.json({ success: true });
  }

  const uri = AtUri.make(evt.did, evt.collection, evt.rkey).toString();

  if (evt.collection === ARTICLE_COLLECTION) {
    if (evt.action === "create" || evt.action === "update") {
      let record: sci.peer.article.Main;
      try {
        record = sci.peer.article.$parse(evt.record);
      } catch {
        return NextResponse.json({ success: false });
      }

      await upsertArticle({
        uri,
        authorDid: evt.did,
        title: record.title,
        blocksJson: serializeBlocks(record.blocks),
        sourceFormat: "markdown",
        broadcasted: 0,
        createdAt: record.createdAt,
        indexedAt: new Date().toISOString(),
      });
    } else if (evt.action === "delete") {
      await deleteArticleCascade(uri);
    }

    return NextResponse.json({ success: true });
  }

  if (evt.collection === "app.bsky.feed.post") {
    if (evt.action === "create" || evt.action === "update") {
      const parsed = parseInlineCommentRecord(evt.record);
      if (!parsed) return NextResponse.json({ success: true });

      const announcement = await getAnnouncementByUri(parsed.rootUri);
      if (!announcement) return NextResponse.json({ success: true });

      await upsertInlineComment({
        uri,
        articleUri: announcement.articleUri,
        authorDid: evt.did,
        text: parsed.text,
        quote: parsed.quote,
        externalUri: parsed.externalUri,
        createdAt: parsed.createdAt,
        indexedAt: new Date().toISOString(),
      });
    } else if (evt.action === "delete") {
      await deleteInlineComment(uri);
      await deleteAnnouncementByUri(uri);
    }
  }

  return NextResponse.json({ success: true });
}
