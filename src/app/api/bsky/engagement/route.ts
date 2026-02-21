import { Client } from "@atproto/lex";
import { AtUri } from "@atproto/syntax";
import { NextRequest, NextResponse } from "next/server";

import { getOAuthClient } from "@/lib/auth/client";
import { getSession } from "@/lib/auth/session";
import { upsertBskyInteraction } from "@/lib/db/queries";

interface EngagementRequest {
  action?: unknown;
  uri?: unknown;
  cid?: unknown;
  text?: unknown;
}

function asAction(input: unknown): "like" | "repost" | "reply" | null {
  if (input === "like" || input === "repost" || input === "reply") {
    return input;
  }
  return null;
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: EngagementRequest;
  try {
    body = (await request.json()) as EngagementRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = asAction(body.action);
  const uri = typeof body.uri === "string" ? body.uri.trim() : "";
  let cid = typeof body.cid === "string" ? body.cid.trim() : "";

  if (!action || !uri) {
    return NextResponse.json({ error: "action and uri are required" }, { status: 400 });
  }

  let subjectAtUri: AtUri;
  try {
    subjectAtUri = new AtUri(uri);
  } catch {
    return NextResponse.json({ error: "Invalid AT URI" }, { status: 400 });
  }

  const oauthClient = await getOAuthClient();
  const oauthSession = await oauthClient.restore(session.did);
  const client = new Client(oauthSession);

  if (!cid) {
    const query = new URLSearchParams({
      repo: subjectAtUri.hostname,
      collection: subjectAtUri.collection,
      rkey: subjectAtUri.rkey,
    });
    const response = await oauthSession.fetchHandler(
      `/xrpc/com.atproto.repo.getRecord?${query.toString()}`,
    );
    if (!response.ok) {
      return NextResponse.json({ error: "Failed to resolve subject cid" }, { status: 400 });
    }
    const record = (await response.json()) as { cid?: unknown };
    cid = typeof record.cid === "string" ? record.cid : "";
  }

  if (!cid) {
    return NextResponse.json({ error: "Failed to resolve subject cid" }, { status: 400 });
  }

  const createdAt = new Date().toISOString();
  let recordUri = "";

  if (action === "like") {
    const created = await client.createRecord({
      $type: "app.bsky.feed.like",
      subject: { uri, cid },
      createdAt,
    });
    recordUri = created.body.uri;
  } else if (action === "repost") {
    const created = await client.createRecord({
      $type: "app.bsky.feed.repost",
      subject: { uri, cid },
      createdAt,
    });
    recordUri = created.body.uri;
  } else {
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) {
      return NextResponse.json({ error: "text is required for reply" }, { status: 400 });
    }

    const created = await client.createRecord({
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
    authorDid: session.did,
    action,
    createdAt,
  });

  return NextResponse.json({ success: true, recordUri });
}
