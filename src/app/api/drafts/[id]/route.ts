import { NextResponse } from "next/server";

import { decodeRouteParam } from "@/lib/articles/uri";
import { deleteDraftById, getDraftById } from "@/lib/db/queries";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: idParam } = await context.params;
  const id = decodeRouteParam(idParam);

  const draft = await getDraftById(id);
  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true, draft });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: idParam } = await context.params;
  const id = decodeRouteParam(idParam);

  await deleteDraftById(id);
  return NextResponse.json({ success: true });
}
