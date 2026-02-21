import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import type { SourceFormat, WorkspaceFileKind } from "@/lib/db";
import {
  createWorkspaceFile,
  getWorkspaceFileById,
  listWorkspaceFiles,
} from "@/lib/db/queries";

interface CreateWorkspaceFileRequest {
  parentId?: unknown;
  name?: unknown;
  kind?: unknown;
  format?: unknown;
  content?: unknown;
}

function asFileKind(input: unknown): WorkspaceFileKind {
  return input === "folder" ? "folder" : "file";
}

function asSourceFormat(input: unknown, name?: string): SourceFormat {
  if (input === "tex") return "tex";
  if (typeof name === "string" && name.toLowerCase().endsWith(".tex")) return "tex";
  return "markdown";
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const files = await listWorkspaceFiles(session.did);
  return NextResponse.json({ success: true, files });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: CreateWorkspaceFileRequest;
  try {
    body = (await request.json()) as CreateWorkspaceFileRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (name.length > 120) {
    return NextResponse.json({ error: "name is too long" }, { status: 400 });
  }

  const parentId = typeof body.parentId === "string" ? body.parentId : null;
  if (parentId) {
    const parent = await getWorkspaceFileById(parentId, session.did);
    if (!parent) {
      return NextResponse.json({ error: "parent not found" }, { status: 404 });
    }
    if (parent.kind !== "folder") {
      return NextResponse.json({ error: "parent must be folder" }, { status: 400 });
    }
  }

  const kind = asFileKind(body.kind);
  const sourceFormat = asSourceFormat(body.format, name);
  const content = typeof body.content === "string" ? body.content : "";

  const file = await createWorkspaceFile({
    ownerDid: session.did,
    parentId,
    name,
    kind,
    sourceFormat: kind === "file" ? sourceFormat : null,
    content: kind === "file" ? content : null,
  });

  return NextResponse.json({ success: true, file });
}
