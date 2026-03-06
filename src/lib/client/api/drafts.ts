"use client";

import { deleteDraftById, getDraftById, listDrafts, saveDraft } from "@/lib/client/store";
import {
  HttpError,
  MAX_DRAFT_CONTENT_LENGTH,
  MAX_TITLE_LENGTH,
  json,
  sourceFormatFromUnknown,
} from "@/lib/client/api/articles";

export async function handleDraftsPath(
  request: Request,
  url: URL,
  pathParts: string[],
): Promise<Response | null> {
  if (pathParts.length === 2) {
    if (request.method === "GET") {
      const drafts = await listDrafts();
      return json({ success: true, drafts });
    }

    if (request.method === "POST") {
      const body = (await request.json()) as {
        id?: unknown;
        title?: unknown;
        content?: unknown;
        sourceFormat?: unknown;
      };
      const title = typeof body.title === "string" ? body.title.trim() : "";
      const content = typeof body.content === "string" ? body.content : "";
      const sourceFormat = sourceFormatFromUnknown(body.sourceFormat);
      const id = typeof body.id === "string" ? body.id : undefined;

      if (!title) throw new HttpError(400, "Title is required");
      if (title.length > MAX_TITLE_LENGTH) {
        throw new HttpError(400, `Title must be <= ${MAX_TITLE_LENGTH} characters`);
      }
      if (!content.trim()) throw new HttpError(400, "Content is required");
      if (content.length > MAX_DRAFT_CONTENT_LENGTH) {
        throw new HttpError(
          400,
          `Content must be <= ${MAX_DRAFT_CONTENT_LENGTH} characters`,
        );
      }

      const draft = await saveDraft({
        id,
        title,
        content,
        sourceFormat,
      });
      return json({ success: true, draftId: draft.id, draft });
    }

    if (request.method === "DELETE") {
      const id = url.searchParams.get("id");
      if (!id) throw new HttpError(400, "Draft id is required");
      await deleteDraftById(id);
      return json({ success: true });
    }
    return null;
  }

  if (pathParts.length === 3) {
    const id = pathParts[2];
    if (request.method === "GET") {
      const draft = await getDraftById(id);
      if (!draft) throw new HttpError(404, "Draft not found");
      return json({ success: true, draft });
    }

    if (request.method === "DELETE") {
      await deleteDraftById(id);
      return json({ success: true });
    }
  }

  return null;
}
