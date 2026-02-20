import { NextRequest, NextResponse } from "next/server";

import type { SourceFormat } from "@/lib/db";
import { deleteDraftById, listDrafts, saveDraft } from "@/lib/db/queries";

const MAX_TITLE_LENGTH = 300;
const MAX_CONTENT_LENGTH = 60_000;

interface DraftRequest {
  id?: unknown;
  title?: unknown;
  content?: unknown;
  sourceFormat?: unknown;
}

function parseSourceFormat(input: unknown): SourceFormat {
  return input === "tex" ? "tex" : "markdown";
}

export async function GET() {
  const drafts = await listDrafts();
  return NextResponse.json({ success: true, drafts });
}

export async function POST(request: NextRequest) {
  let body: DraftRequest;
  try {
    body = (await request.json()) as DraftRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const content = typeof body.content === "string" ? body.content : "";
  const sourceFormat = parseSourceFormat(body.sourceFormat);
  const id = typeof body.id === "string" ? body.id : undefined;

  if (!title) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return NextResponse.json(
      { error: `Title must be <= ${MAX_TITLE_LENGTH} characters` },
      { status: 400 },
    );
  }
  if (!content.trim()) {
    return NextResponse.json({ error: "Content is required" }, { status: 400 });
  }
  if (content.length > MAX_CONTENT_LENGTH) {
    return NextResponse.json(
      { error: `Content must be <= ${MAX_CONTENT_LENGTH} characters` },
      { status: 400 },
    );
  }

  const draft = await saveDraft({
    id,
    title,
    content,
    sourceFormat,
  });

  return NextResponse.json({ success: true, draftId: draft.id, draft });
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Draft id is required" }, { status: 400 });
  }

  await deleteDraftById(id);
  return NextResponse.json({ success: true });
}
