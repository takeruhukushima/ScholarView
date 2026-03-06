"use client";

import { AtUri } from "@atproto/syntax";

import { getSessionFetchHandler } from "@/lib/auth/browser";
import { upsertBskyInteraction } from "@/lib/client/store";
import type { BskyInteractionAction } from "@/lib/types";
import { HttpError, getAuthedLexClient, json } from "@/lib/client/api/articles";

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

export async function handleEngagement(request: Request): Promise<Response> {
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
