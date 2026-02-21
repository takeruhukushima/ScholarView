import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import type { SourceFormat } from "@/lib/db";
import { resolveWorkspaceImports } from "@/lib/workspace/imports";

interface ResolveRequest {
  sourceFormat?: unknown;
  text?: unknown;
}

function asSourceFormat(input: unknown): SourceFormat {
  return input === "tex" ? "tex" : "markdown";
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ResolveRequest;
  try {
    body = (await request.json()) as ResolveRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text : "";
  const sourceFormat = asSourceFormat(body.sourceFormat);

  const resolved = await resolveWorkspaceImports({
    text,
    sourceFormat,
    ownerDid: session.did,
  });

  return NextResponse.json({
    success: true,
    resolvedText: resolved.resolvedText,
    diagnostics: resolved.diagnostics,
  });
}
