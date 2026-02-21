import { NextRequest, NextResponse } from "next/server";

import { decodeRouteParam } from "@/lib/articles/uri";
import { getSession } from "@/lib/auth/session";
import type { SourceFormat } from "@/lib/db";
import {
  deleteWorkspaceFileById,
  getWorkspaceFileById,
  updateWorkspaceFileById,
} from "@/lib/db/queries";

interface UpdateWorkspaceFileRequest {
  parentId?: unknown;
  name?: unknown;
  content?: unknown;
  expanded?: unknown;
  sourceFormat?: unknown;
  linkedArticleDid?: unknown;
  linkedArticleRkey?: unknown;
  linkedArticleUri?: unknown;
}

function asSourceFormat(input: unknown): SourceFormat {
  return input === "tex" ? "tex" : "markdown";
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: rawId } = await context.params;
  const id = decodeRouteParam(rawId);

  const existing = await getWorkspaceFileById(id, session.did);
  if (!existing) {
    return NextResponse.json({ error: "file not found" }, { status: 404 });
  }

  let body: UpdateWorkspaceFileRequest;
  try {
    body = (await request.json()) as UpdateWorkspaceFileRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parentId =
    body.parentId === null
      ? null
      : typeof body.parentId === "string"
        ? body.parentId
        : undefined;
  const name = typeof body.name === "string" ? body.name.trim() : undefined;
  const content = typeof body.content === "string" ? body.content : undefined;
  const expanded =
    body.expanded === 1 || body.expanded === true
      ? 1
      : body.expanded === 0 || body.expanded === false
        ? 0
        : undefined;
  const sourceFormat =
    body.sourceFormat === undefined ? undefined : asSourceFormat(body.sourceFormat);
  const linkedArticleDid =
    body.linkedArticleDid === null
      ? null
      : typeof body.linkedArticleDid === "string"
        ? body.linkedArticleDid
        : undefined;
  const linkedArticleRkey =
    body.linkedArticleRkey === null
      ? null
      : typeof body.linkedArticleRkey === "string"
        ? body.linkedArticleRkey
        : undefined;
  const linkedArticleUri =
    body.linkedArticleUri === null
      ? null
      : typeof body.linkedArticleUri === "string"
        ? body.linkedArticleUri
        : undefined;

  if (name !== undefined && !name) {
    return NextResponse.json({ error: "name must not be empty" }, { status: 400 });
  }

  if (parentId !== undefined && parentId !== null) {
    if (parentId === id) {
      return NextResponse.json({ error: "invalid parentId" }, { status: 400 });
    }
    const parent = await getWorkspaceFileById(parentId, session.did);
    if (!parent || parent.kind !== "folder") {
      return NextResponse.json({ error: "parent folder not found" }, { status: 404 });
    }
  }

  const updated = await updateWorkspaceFileById(id, session.did, {
    parentId,
    name,
    content,
    expanded,
    sourceFormat,
    linkedArticleDid,
    linkedArticleRkey,
    linkedArticleUri,
  });

  return NextResponse.json({ success: true, file: updated });
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: rawId } = await context.params;
  const id = decodeRouteParam(rawId);

  const existing = await getWorkspaceFileById(id, session.did);
  if (!existing) {
    return NextResponse.json({ error: "file not found" }, { status: 404 });
  }

  await deleteWorkspaceFileById(id, session.did);
  return NextResponse.json({ success: true });
}
