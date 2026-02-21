import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import type { ArticleBlock } from "@/lib/articles/blocks";
import type { SourceFormat } from "@/lib/db";
import {
  createWorkspaceFile,
  getArticleByDidAndRkey,
  getRecentArticles,
  getWorkspaceFileByLinkedArticleUri,
  listWorkspaceFiles,
  updateWorkspaceFileById,
} from "@/lib/db/queries";

function blocksToSource(blocks: ArticleBlock[], sourceFormat: SourceFormat): string {
  if (sourceFormat === "tex") {
    return blocks
      .map((block) => {
        const level = block.level <= 1 ? 1 : block.level === 2 ? 2 : 3;
        const headingCommand =
          level === 1
            ? "\\section"
            : level === 2
              ? "\\subsection"
              : "\\subsubsection";
        const heading = `${headingCommand}{${block.heading}}`;
        const content = block.content.trim();
        return content ? `${heading}\n\n${content}` : heading;
      })
      .join("\n\n")
      .trim();
  }

  return blocks
    .map((block) => {
      const level = Math.max(1, Math.min(3, block.level));
      const heading = `${"#".repeat(level)} ${block.heading}`;
      const content = block.content.trim();
      return content ? `${heading}\n\n${content}` : heading;
    })
    .join("\n\n")
    .trim();
}

function sanitizeBaseName(input: string): string {
  const sanitized = input
    .trim()
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return sanitized || "article";
}

function uniqueFileName(
  title: string,
  sourceFormat: SourceFormat,
  existingNames: Set<string>,
  fallbackSeed: string,
): string {
  const ext = sourceFormat === "tex" ? "tex" : "md";
  const base = sanitizeBaseName(title || fallbackSeed);

  let n = 0;
  for (;;) {
    const candidate = n === 0 ? `${base}.${ext}` : `${base}-${n + 1}.${ext}`;
    const key = candidate.toLowerCase();
    if (!existingNames.has(key)) {
      existingNames.add(key);
      return candidate;
    }
    n += 1;
  }
}

export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [allArticles, existingFiles] = await Promise.all([
    getRecentArticles(500),
    listWorkspaceFiles(session.did),
  ]);
  const myArticles = allArticles.filter((article) => article.authorDid === session.did);

  const existingNames = new Set(existingFiles.map((file) => file.name.toLowerCase()));

  let created = 0;
  for (const article of myArticles) {
    const existingLinked = await getWorkspaceFileByLinkedArticleUri(article.uri, session.did);
    if (existingLinked) continue;

    const detail = await getArticleByDidAndRkey(article.did, article.rkey);
    if (!detail) continue;

    const sourceFormat: SourceFormat = detail.sourceFormat === "tex" ? "tex" : "markdown";
    const content = blocksToSource(detail.blocks, sourceFormat);
    const fileName = uniqueFileName(detail.title, sourceFormat, existingNames, article.rkey);

    const createdFile = await createWorkspaceFile({
      ownerDid: session.did,
      parentId: null,
      name: fileName,
      kind: "file",
      sourceFormat,
      content,
    });

    await updateWorkspaceFileById(createdFile.id, session.did, {
      linkedArticleDid: article.did,
      linkedArticleRkey: article.rkey,
      linkedArticleUri: article.uri,
    });

    created += 1;
  }

  const files = await listWorkspaceFiles(session.did);
  return NextResponse.json({ success: true, created, files });
}
