"use client";

import { Client } from "@atproto/lex";
import { AtUri } from "@atproto/syntax";

import * as sci from "@/lexicons/sci";
import { GUEST_DID_PREFIX } from "@/lib/guest-identity";
import {
  parseMarkdownToBlocks,
  parseTexToBlocks,
  serializeBlocks,
  type ArticleBlock,
} from "@/lib/articles/blocks";
import {
  compactBibliography,
  normalizeBibliography,
  serializeBibliography,
} from "@/lib/articles/citations";
import {
  ARTICLE_COLLECTION,
  buildScholarViewArticleUrl,
} from "@/lib/articles/uri";
import {
  getLexClientForCurrentSession,
  getSessionFetchHandler,
} from "@/lib/auth/browser";
import {
  createWorkspaceFile,
  deleteWorkspaceFileById,
  getAnnouncementByArticleUri,
  getArticleByDidAndRkey,
  getRecentArticles,
  getWorkspaceFileById,
  getWorkspaceFileByLinkedArticleUri,
  getWorkspaceFileByPath,
  listWorkspaceFiles,
  moveWorkspaceFile,
  updateArticleByUri,
  updateWorkspaceFileById,
  upsertArticle,
  upsertArticleAnnouncement,
  upsertBskyInteraction,
} from "@/lib/client/store";
import type {
  ArticleAuthor,
  SourceFormat,
  WorkspaceFileNode,
} from "@/lib/types";
import { resolveWorkspaceImports } from "@/lib/workspace/imports";
import { writeGuestRecord } from "@/lib/firebase-client";

import {
  HttpError,
  MAX_TITLE_LENGTH,
  asObject,
  asString,
  buildWorkspaceArticleImageAssets,
  discoverAnnouncement,
  getDidOrLocal,
  json,
  normalizeAnnouncementRootWithLex,
  normalizeAnnouncementRootWithPublicApi,
  requireDid,
  safeTimestampMs,
  sourceFormatFromUnknown,
  syncOwnArticlesFromRepo,
  triggerRelayCrawl,
} from "@/lib/client/api/articles";

function blocksToSource(blocks: ArticleBlock[], sourceFormat: SourceFormat): string {
  if (sourceFormat === "tex") {
    return blocks
      .map((block) => {
        const level = block.level <= 1 ? 1 : block.level === 2 ? 2 : 3;
        const command =
          level === 1 ? "\\section" : level === 2 ? "\\subsection" : "\\subsubsection";
        const heading = `${command}{${block.heading}}`;
        const content = block.content.trim();
        return content ? `${heading}\n\n${content}` : heading;
      })
      .join("\n\n")
      .trim();
  }

  return blocks
    .map((block) => {
      const heading = `${"#".repeat(Math.max(1, Math.min(3, block.level)))} ${block.heading}`;
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

function numericSuffixRank(name: string): number {
  const dotIdx = name.lastIndexOf(".");
  const stem = dotIdx > 0 ? name.slice(0, dotIdx) : name;
  const match = stem.match(/-(\d+)$/);
  if (!match) return 0;
  const n = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(n) && n > 1 ? n : 1;
}

function compareDuplicatePriority(a: WorkspaceFileNode, b: WorkspaceFileNode): number {
  const updatedA = safeTimestampMs(a.updatedAt) ?? Number.NEGATIVE_INFINITY;
  const updatedB = safeTimestampMs(b.updatedAt) ?? Number.NEGATIVE_INFINITY;
  if (updatedA !== updatedB) return updatedB - updatedA;

  const suffixA = numericSuffixRank(a.name);
  const suffixB = numericSuffixRank(b.name);
  if (suffixA !== suffixB) return suffixA - suffixB;

  const createdA = safeTimestampMs(a.createdAt) ?? Number.POSITIVE_INFINITY;
  const createdB = safeTimestampMs(b.createdAt) ?? Number.POSITIVE_INFINITY;
  if (createdA !== createdB) return createdA - createdB;

  return a.id.localeCompare(b.id);
}

async function cleanupDuplicateWorkspaceFilesByLinkedArticleUri(
  did: string,
  existingFiles?: WorkspaceFileNode[],
): Promise<{ deduped: number; files: WorkspaceFileNode[] }> {
  const files = existingFiles ?? (await listWorkspaceFiles(did));
  const byLinkedUri = new Map<string, WorkspaceFileNode[]>();

  for (const file of files) {
    const linkedUri = typeof file.linkedArticleUri === "string" ? file.linkedArticleUri.trim() : "";
    if (!linkedUri) continue;
    const grouped = byLinkedUri.get(linkedUri) ?? [];
    grouped.push(file);
    byLinkedUri.set(linkedUri, grouped);
  }

  let deduped = 0;
  for (const grouped of byLinkedUri.values()) {
    if (grouped.length < 2) continue;

    const sorted = [...grouped].sort(compareDuplicatePriority);
    const survivor = sorted[0];
    const patch: {
      linkedArticleDid?: string | null;
      linkedArticleRkey?: string | null;
      linkedArticleUri?: string | null;
    } = {};

    for (let i = 1; i < sorted.length; i += 1) {
      const duplicate = sorted[i];
      if (!patch.linkedArticleDid && !survivor.linkedArticleDid && duplicate.linkedArticleDid) {
        patch.linkedArticleDid = duplicate.linkedArticleDid;
      }
      if (!patch.linkedArticleRkey && !survivor.linkedArticleRkey && duplicate.linkedArticleRkey) {
        patch.linkedArticleRkey = duplicate.linkedArticleRkey;
      }
      if (!patch.linkedArticleUri && !survivor.linkedArticleUri && duplicate.linkedArticleUri) {
        patch.linkedArticleUri = duplicate.linkedArticleUri;
      }
      await deleteWorkspaceFileById(duplicate.id, did);
      deduped += 1;
    }

    if (Object.keys(patch).length > 0) {
      await updateWorkspaceFileById(survivor.id, did, patch);
    }
  }

  if (deduped === 0) {
    return { deduped: 0, files };
  }

  const refreshed = await listWorkspaceFiles(did);
  return { deduped, files: refreshed };
}

export async function syncLegacyArticles(force = false): Promise<Response> {
  await syncOwnArticlesFromRepo({ force });
  const did = await requireDid();
  const initialFiles = await listWorkspaceFiles(did);
  const { deduped, files: existingFiles } = await cleanupDuplicateWorkspaceFilesByLinkedArticleUri(
    did,
    initialFiles,
  );
  const allArticles = await getRecentArticles(500);
  const myArticles = allArticles.filter((article) => article.authorDid === did);
  const existingNames = new Set(existingFiles.map((file) => file.name.toLowerCase()));

  let created = 0;
  for (const article of myArticles) {
    // Check if any existing file is already linked to this URI
    let existingLinked = await getWorkspaceFileByLinkedArticleUri(article.uri, did);
    
    // Backup check: search through currently loaded files in case the index is stale
    if (!existingLinked) {
      existingLinked = existingFiles.find(f => f.linkedArticleUri === article.uri) ?? null;
    }

    if (existingLinked) {
      if (force) {
        const detail = await getArticleByDidAndRkey(article.did, article.rkey);
        if (detail) {
          const sourceFormat = detail.sourceFormat === "tex" ? "tex" : "markdown";
          const content = blocksToSource(detail.blocks, sourceFormat);
          await updateWorkspaceFileById(existingLinked.id, did, {
            content,
            sourceFormat,
            linkedArticleDid: article.did,
            linkedArticleRkey: article.rkey,
            linkedArticleUri: article.uri,
          });
        }
      }
      continue;
    }

    const detail = await getArticleByDidAndRkey(article.did, article.rkey);
    if (!detail) continue;

    const sourceFormat = detail.sourceFormat === "tex" ? "tex" : "markdown";
    const content = blocksToSource(detail.blocks, sourceFormat);
    const name = uniqueFileName(detail.title, sourceFormat, existingNames, article.rkey);

    const file = await createWorkspaceFile({
      ownerDid: did,
      parentId: null,
      name,
      kind: "file",
      sourceFormat,
      content,
    });

    await updateWorkspaceFileById(file.id, did, {
      linkedArticleDid: article.did,
      linkedArticleRkey: article.rkey,
      linkedArticleUri: article.uri,
    });

    created += 1;
  }

  const files = await listWorkspaceFiles(did);
  return json({ success: true, created, deduped, files });
}

async function seedWelcomeWorkspace(did: string): Promise<void> {
  const tutorialFolder = await createWorkspaceFile({
    ownerDid: did,
    parentId: null,
    name: "tutorial",
    kind: "folder",
  });

  const imgFolder = await createWorkspaceFile({
    ownerDid: did,
    parentId: tutorialFolder.id,
    name: "images",
    kind: "folder",
  });

  const transparentPixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
  await createWorkspaceFile({
    ownerDid: did,
    parentId: imgFolder.id,
    name: "sample-image.png",
    kind: "file",
    sourceFormat: null, // Image should not have markdown format
    content: transparentPixel,
  });

  const bibContent = `@article{scholarview2026,
  author = {ScholarView Team},
  title = {DeSci Review and Publishing on AT Protocol},
  journal = {Journal of Open Science},
  year = {2026},
  volume = {1},
  pages = {1-10}
}`;

  await createWorkspaceFile({
    ownerDid: did,
    parentId: tutorialFolder.id,
    name: "references.bib",
    kind: "file",
    sourceFormat: "markdown",
    content: bibContent,
  });

  await createWorkspaceFile({
    ownerDid: did,
    parentId: tutorialFolder.id,
    name: "welcome.md",
    kind: "file",
    sourceFormat: "markdown",
    content: `# ScholarView Comprehensive Guide

Welcome to your DeSci workspace! This document covers everything you can do with ScholarView's Markdown editor.

## 1. Document Structure

# Level 1 Heading
## Level 2 Heading
### Level 3 Heading

You can create lists:
- Item A
- Item B
  - Sub-item B1
1. Numbered List
2. Another Item

> This is a blockquote. Use it for emphasized text or external quotes.

---

## 2. Mathematical Notation (LaTeX)

ScholarView uses KaTeX for fast and beautiful math rendering.

**Inline Math**: Use single dollar signs: $E = mc^2$ or $\\lambda = \\frac{h}{p}$.

**Display (Block) Math**: Use double dollar signs for multi-line or centered equations:

$$
I = \\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}
$$

You can also use complex environments:

$$
\\begin{pmatrix}
a & b \\\\
c & d
\\end{pmatrix}
\\cdot
\\begin{pmatrix}
x \\\\
y
\\end{pmatrix}
=
\\begin{pmatrix}
ax + by \\\\
cx + dy
\\end{pmatrix}
$$

## 3. Citations and References

ScholarView handles academic citations automatically.
1. Create a \`.bib\` file in your workspace (see \`references.bib\` in this folder).
2. Use the \`[@citekey]\` syntax in your text.

Example: ScholarView is built for decentralized science [@scholarview2026].

*Tip: Click the citation icon in the block menu to browse and insert references from your bib files.*

## 4. Media and Image Assets

Embed images from your workspace using the \`workspace://\` protocol:

![Sample Figure](workspace://sample-image.png)
*Figure 1: A transparent placeholder image stored in the images/ folder.*

## 5. Rich Renderer Features

The panel on the right is a **Rich Renderer**. It doesn't just show a preview; it parses your document into semantic blocks.
- **Click a block** in the renderer to jump to that line in the editor.
- **Drag handle** (on the left of the editor) to reorder sections of your paper.

## 6. Publishing (Broadcast)

When your paper is ready:
1. Click **Broadcast** at the top right.
2. Sign in with your AT Protocol (Bluesky) account.
3. Your article will be published as a record on your repository.
4. A discussion thread will be automatically created on Bluesky!

Happy writing and reviewing!`,
  });
}

export async function handleWorkspaceFilesPath(
  request: Request,
  pathParts: string[],
): Promise<Response | null> {
  if (pathParts.length === 3) {
    const did = await getDidOrLocal();
    if (request.method === "GET") {
      let files = await listWorkspaceFiles(did);
      if (files.length === 0 && did === "local") {
        await seedWelcomeWorkspace(did);
        files = await listWorkspaceFiles(did);
      }
      return json({ success: true, files });
    }

    if (request.method === "POST") {
      const body = (await request.json()) as {
        parentId?: unknown;
        name?: unknown;
        kind?: unknown;
        format?: unknown;
        content?: unknown;
      };
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) throw new HttpError(400, "name is required");
      if (name.length > 120) throw new HttpError(400, "name is too long");

      const parentId = typeof body.parentId === "string" ? body.parentId : null;
      if (parentId) {
        const parent = await getWorkspaceFileById(parentId, did);
        if (!parent) throw new HttpError(404, "parent not found");
        if (parent.kind !== "folder") throw new HttpError(400, "parent must be folder");
      }

      const kind = body.kind === "folder" ? "folder" : "file";
      const sourceFormat =
        body.format === "tex" || name.toLowerCase().endsWith(".tex") ? "tex" : "markdown";
      const content = typeof body.content === "string" ? body.content : "";

      const file = await createWorkspaceFile({
        ownerDid: did,
        parentId,
        name,
        kind,
        sourceFormat: kind === "file" ? sourceFormat : null,
        content: kind === "file" ? content : null,
      });

      return json({ success: true, file });
    }
    return null;
  }

  if (pathParts.length >= 4) {
    const did = await getDidOrLocal();
    const id = pathParts[3];

    if (id === "move") {
      if (request.method !== "POST") return null;
      const body = (await request.json()) as {
        draggedId: string;
        targetId: string;
        position: "before" | "after" | "inside";
      };
      const result = await moveWorkspaceFile(
        body.draggedId,
        body.targetId,
        body.position,
        did,
      );
      if (!result.success) {
        throw new HttpError(400, result.error ?? "Failed to move item");
      }
      return json({ success: true, updates: result.updates || [] });
    }

    if (pathParts.length === 4) {
      if (request.method === "PATCH") {
        const existing = await getWorkspaceFileById(id, did);
        if (!existing) throw new HttpError(404, "file not found");

        const body = (await request.json()) as {
          parentId?: unknown;
          name?: unknown;
          content?: unknown;
          sortOrder?: unknown;
          expanded?: unknown;
          sourceFormat?: unknown;
          linkedArticleDid?: unknown;
          linkedArticleRkey?: unknown;
          linkedArticleUri?: unknown;
        };

        const parentId =
          body.parentId === null
            ? null
            : typeof body.parentId === "string"
              ? body.parentId
              : undefined;
        const name = typeof body.name === "string" ? body.name.trim() : undefined;
        const content = typeof body.content === "string" ? body.content : undefined;
        const sortOrder =
          typeof body.sortOrder === "number" && Number.isFinite(body.sortOrder)
            ? Math.max(0, Math.floor(body.sortOrder))
            : undefined;
        const expanded =
          body.expanded === 1 || body.expanded === true
            ? 1
            : body.expanded === 0 || body.expanded === false
              ? 0
              : undefined;
        const sourceFormat =
          body.sourceFormat === undefined
            ? undefined
            : sourceFormatFromUnknown(body.sourceFormat);
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
          throw new HttpError(400, "name must not be empty");
        }
        if (parentId !== undefined && parentId !== null) {
          if (parentId === id) throw new HttpError(400, "invalid parentId");
          const parent = await getWorkspaceFileById(parentId, did);
          if (!parent || parent.kind !== "folder") {
            throw new HttpError(404, "parent folder not found");
          }
        }

        const updated = await updateWorkspaceFileById(id, did, {
          parentId,
          name,
          content,
          sortOrder,
          expanded,
          sourceFormat,
          linkedArticleDid,
          linkedArticleRkey,
          linkedArticleUri,
        });

        return json({ success: true, file: updated });
      }

      if (request.method === "DELETE") {
        const existing = await getWorkspaceFileById(id, did);
        if (!existing) throw new HttpError(404, "file not found");
        await deleteWorkspaceFileById(id, did);
        return json({ success: true });
      }
      return null;
    }

    if (pathParts.length === 5 && pathParts[4] === "publish") {
      if (request.method !== "POST") return null;
      return publishWorkspaceFile(request, id, did);
    }
  }

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

async function findThreadTail(
  announcementUri: string,
  authorDid: string,
  lex: Client,
): Promise<{ uri: string; cid: string }> {
  try {
    const query = new URLSearchParams({
      uri: announcementUri,
      depth: "100",
      parentHeight: "0",
    });
    const response = await lex.fetchHandler(
      `/xrpc/app.bsky.feed.getPostThread?${query.toString()}`,
      { method: "GET" },
    );
    if (!response.ok) return { uri: announcementUri, cid: await resolveCid(announcementUri) };
    const payload = (await response.json()) as { thread?: unknown };
    const thread = asObject(payload.thread);
    if (!thread) return { uri: announcementUri, cid: await resolveCid(announcementUri) };

    const authorPosts: Array<{ uri: string; cid: string; createdAt: string }> = [];
    const traverse = (node: unknown) => {
      const post = asObject(asObject(node)?.post);
      if (!post) return;
      
      const postAuthor = asObject(post.author);
      const postAuthorDid = asString(postAuthor?.did);
      
      // Only collect posts made by the article author
      if (postAuthorDid === authorDid) {
        const uri = asString(post.uri);
        const cid = asString(post.cid);
        const record = asObject(post.record);
        const createdAt = asString(record?.createdAt) || new Date().toISOString();
        if (uri && cid) authorPosts.push({ uri, cid, createdAt });
      }

      const replies = Array.isArray(asObject(node)?.replies) ? asObject(node)?.replies : [];
      for (const reply of (replies as unknown[])) traverse(reply);
    };

    traverse(thread);
    
    // Sort by createdAt ascending to find the very last post by the author
    authorPosts.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    
    if (authorPosts.length > 0) {
      return {
        uri: authorPosts[authorPosts.length - 1].uri,
        cid: authorPosts[authorPosts.length - 1].cid,
      };
    }
  } catch (e) {
    console.error("Failed to find thread tail:", e);
  }
  return { uri: announcementUri, cid: await resolveCid(announcementUri) };
}

async function publishWorkspaceFile(
  request: Request,
  fileId: string,
  did: string,
): Promise<Response> {
  const isGuest = did.startsWith(GUEST_DID_PREFIX);
  const lex = !isGuest ? await getLexClientForCurrentSession() : null;
  const file = await getWorkspaceFileById(fileId, did);
  if (!file) throw new HttpError(404, "File not found");
  if (file.kind !== "file") throw new HttpError(400, "Only files can be published");

  const body = (await request.json()) as {
    title?: unknown;
    authors?: unknown;
    broadcastToBsky?: unknown;
    notifyUpdate?: unknown;
    broadcastText?: unknown;
    bibliography?: unknown;
  };

  const customBroadcastText = typeof body.broadcastText === "string" ? body.broadcastText : null;
  const shouldBroadcast = !isGuest && body.broadcastToBsky === true;
  const shouldNotifyUpdate = !isGuest && body.notifyUpdate === true;

  const title =
    typeof body.title === "string" && body.title.trim()
      ? body.title.trim()
      : file.name.replace(/\.[^.]+$/, "").trim() || "Untitled";
  if (title.length > MAX_TITLE_LENGTH) {
    throw new HttpError(400, `Title must be <= ${MAX_TITLE_LENGTH} characters`);
  }

  const authors = Array.isArray(body.authors) ? (body.authors as ArticleAuthor[]) : [];
  const sourceFormat = file.sourceFormat === "tex" ? "tex" : "markdown";
  const rawText = file.content ?? "";

  const resolved = await resolveWorkspaceImports({
    text: rawText,
    sourceFormat,
    resolveFileByPath: (path) => getWorkspaceFileByPath(path, did),
  });

  const blocks =
    sourceFormat === "tex"
      ? parseTexToBlocks(resolved.resolvedText)
      : parseMarkdownToBlocks(resolved.resolvedText);
  if (blocks.length === 0) throw new HttpError(400, "At least one section is required");

  // Skip image asset upload for guests for now
  const imageAssets = (lex && !isGuest) 
    ? await buildWorkspaceArticleImageAssets(lex, blocks, sourceFormat, did, file)
    : [];

  const bibliographyInput =
    body.bibliography === undefined ? null : normalizeBibliography(body.bibliography);
  const now = new Date().toISOString();
  const linkedDid = file.linkedArticleDid;
  const linkedRkey = file.linkedArticleRkey;
  const existing =
    linkedDid && linkedRkey ? await getArticleByDidAndRkey(linkedDid, linkedRkey) : null;

  let mode: "created" | "updated" = "created";
  let targetDid = did;
  let targetRkey = "";
  let articleUri = "";
  let broadcasted: 0 | 1 = 0;

  if (existing) {
    if (existing.authorDid !== did) throw new HttpError(403, "Forbidden");
    mode = "updated";
    targetDid = existing.did;
    targetRkey = existing.rkey;
    articleUri = existing.uri;

    const bibliography = compactBibliography(
      bibliographyInput ?? existing.bibliography,
    );

    if (lex && !isGuest) {
      await lex.put(
        sci.peer.article.main,
        {
          title,
          authors,
          blocks,
          bibliography,
          images: imageAssets as unknown as sci.peer.article.ImageAsset[],
          createdAt: new Date(existing.createdAt).toISOString(),
        },
        { rkey: targetRkey },
      );
    }

    let announcement = await getAnnouncementByArticleUri(articleUri);
    // Discovery: if announcement is missing from local DB, try to find it via author's feed
    if (!isGuest && !announcement) {
      const discovered = await discoverAnnouncement(did, targetRkey, fetch);
      if (discovered) {
        await upsertArticleAnnouncement({
          articleUri,
          announcementUri: discovered.uri,
          announcementCid: discovered.cid,
          authorDid: did,
          createdAt: now,
        });
        announcement = {
          articleUri,
          announcementUri: discovered.uri,
          announcementCid: discovered.cid,
          authorDid: did,
          createdAt: now,
        };
      }
    }
    if (lex && !isGuest && announcement) {
      const normalizedRoot =
        (await normalizeAnnouncementRootWithLex(announcement.announcementUri, lex)) ??
        (await normalizeAnnouncementRootWithPublicApi(announcement.announcementUri, fetch));
      if (normalizedRoot && normalizedRoot.uri !== announcement.announcementUri) {
        await upsertArticleAnnouncement({
          articleUri,
          announcementUri: normalizedRoot.uri,
          announcementCid: normalizedRoot.cid,
          authorDid: did,
          createdAt: now,
        });
        announcement = {
          ...announcement,
          announcementUri: normalizedRoot.uri,
          announcementCid: normalizedRoot.cid,
          createdAt: now,
        };
      }
    }

    if (lex && shouldBroadcast && shouldNotifyUpdate) {
      if (!announcement && existing.broadcasted === 1) {
        throw new HttpError(
          409,
          "Existing discussion root was not found. Open the discussion once and retry.",
        );
      }

      const atprotoAtUrl = buildScholarViewArticleUrl(targetDid, targetRkey);
      let postText = `更新した論文を公開しました：『${title}』 ${atprotoAtUrl}`;
      let embedUri = atprotoAtUrl;

      if (customBroadcastText) {
        postText = customBroadcastText.replace(/\{\{article_url\}\}/g, atprotoAtUrl);
        // Try to extract the edited URL from the text to use for the link card
        const urlMatch = postText.match(/https?:\/\/[^\s]+/);
        if (urlMatch) {
          embedUri = urlMatch[0];
        }
      }

      console.log(`[Publish] Broadcasting update. Text: "${postText}", Embed: ${embedUri}`);

      // If we have an existing announcement, we want to reply to the tail of the thread
      let reply: { root: { uri: string; cid: string }; parent: { uri: string; cid: string } } | undefined = undefined;
      if (announcement) {
        // Use author DID (did) to find the correct tail
        const tail = await findThreadTail(announcement.announcementUri, did, lex);
        reply = {
          root: { uri: announcement.announcementUri, cid: announcement.announcementCid },
          parent: { uri: tail.uri, cid: tail.cid },
        };
      }

      const post = await lex.createRecord({
        $type: "app.bsky.feed.post",
        text: postText,
        createdAt: now,
        ...(reply ? { reply } : {}),
        embed: {
          $type: "app.bsky.embed.external",
          external: {
            uri: embedUri,
            title,
            description: "ScholarViewで論文を公開しました",
          },
        },
      });

      if (!announcement) {
        await upsertArticleAnnouncement({
          articleUri,
          announcementUri: post.body.uri,
          announcementCid: post.body.cid,
          authorDid: did,
          createdAt: now,
        });
      }
      broadcasted = 1;
    } else {
      broadcasted = announcement ? 1 : 0;
    }

    await updateArticleByUri(articleUri, {
      title,
      authorsJson: JSON.stringify(authors),
      blocksJson: serializeBlocks(blocks),
      bibliographyJson: serializeBibliography(bibliography),
      imagesJson: JSON.stringify(imageAssets),
      sourceFormat,
      indexedAt: now,
      broadcasted,
    });
  } else {
    mode = "created";
    const bibliography = compactBibliography(bibliographyInput ?? []);
    
    if (lex) {
      const created = await lex.create(sci.peer.article.main, {
        title,
        authors,
        blocks,
        bibliography,
        images: imageAssets as unknown as sci.peer.article.ImageAsset[],
        createdAt: now,
      });

      const atUri = new AtUri(created.uri);

      targetDid = did;
      targetRkey = atUri.rkey;
      articleUri = created.uri;

      let announcement: { uri: string; cid: string } | null = null;
      if (shouldBroadcast) {
        const atprotoAtUrl = buildScholarViewArticleUrl(targetDid, targetRkey);
        let postText = `新しい論文/実験計画を公開しました：『${title}』 ${atprotoAtUrl}`;
        let embedUri = atprotoAtUrl;

        if (customBroadcastText) {
          postText = customBroadcastText.replace(/\{\{article_url\}\}/g, atprotoAtUrl);
          const urlMatch = postText.match(/https?:\/\/[^\s]+/);
          if (urlMatch) {
            embedUri = urlMatch[0];
          }
        }

        console.log(`[Publish] Broadcasting new article. Text: "${postText}", Embed: ${embedUri}`);

        const post = await lex.createRecord({
          $type: "app.bsky.feed.post",
          text: postText,
          createdAt: now,
          embed: {
            $type: "app.bsky.embed.external",
            external: {
              uri: embedUri,
              title,
              description: "ScholarViewで論文を公開しました",
            },
          },
        });
        announcement = { uri: post.body.uri, cid: post.body.cid };
      }

      await upsertArticle({
        uri: articleUri,
        authorDid: did,
        title,
        authorsJson: JSON.stringify(authors),
        blocksJson: serializeBlocks(blocks),
        bibliographyJson: serializeBibliography(bibliography),
        imagesJson: JSON.stringify(imageAssets),
        sourceFormat,
        broadcasted: announcement ? 1 : 0,
        createdAt: now,
        indexedAt: now,
      });

      if (announcement) {
        await upsertArticleAnnouncement({
          articleUri,
          announcementUri: announcement.uri,
          announcementCid: announcement.cid,
          authorDid: did,
          createdAt: now,
        });
        broadcasted = 1;
      } else {
        broadcasted = 0;
      }
    } else {
      // Guest local publish
      targetDid = did;
      targetRkey = Math.random().toString(36).substring(2, 12);
      articleUri = `at://${targetDid}/${ARTICLE_COLLECTION}/${targetRkey}`;

      const atprotoAtUrl = buildScholarViewArticleUrl(targetDid, targetRkey);
      const postText = customBroadcastText
        ? customBroadcastText.replace(/\{\{article_url\}\}/g, atprotoAtUrl)
        : `新しい論文/実験計画を公開しました：『${title}』 ${atprotoAtUrl}`;

      const articleValue = {
        title,
        authors,
        blocks,
        bibliography,
        images: imageAssets as unknown as sci.peer.article.ImageAsset[],
        createdAt: now,
      };

      await upsertArticle({
        uri: articleUri,
        authorDid: did,
        title,
        authorsJson: JSON.stringify(authors),
        blocksJson: serializeBlocks(blocks),
        bibliographyJson: serializeBibliography(bibliography),
        imagesJson: JSON.stringify([]),
        sourceFormat,
        broadcasted: 1, // ゲストでも「公開済み」とする
        createdAt: now,
        indexedAt: now,
      });

      // Write article to Firestore
      await writeGuestRecord(did, ARTICLE_COLLECTION, targetRkey, articleValue, now).catch(e => console.error("Failed to write guest article to Firestore:", e));

      // ゲスト用のローカル告知レコードを作成
      const announcementRkey = Math.random().toString(36).substring(2, 12);
      const announcementUri = `at://${did}/app.bsky.feed.post/${announcementRkey}`;
      const announcementCid = "local-guest-cid";

      const announcementValue = {
        $type: "app.bsky.feed.post",
        text: postText,
        createdAt: now,
        embed: {
          $type: "app.bsky.embed.external",
          external: {
            uri: atprotoAtUrl,
            title,
            description: "ScholarViewで論文を公開しました",
          },
        },
      };

      await upsertArticleAnnouncement({
        articleUri,
        announcementUri,
        announcementCid,
        authorDid: did,
        createdAt: now,
      });

      // Write announcement to Firestore
      await writeGuestRecord(did, "app.bsky.feed.post", announcementRkey, announcementValue, now).catch(e => console.error("Failed to write guest announcement to Firestore:", e));
      void triggerRelayCrawl(did);

      // 最初の投稿として自分自身のDBにも入れる
      await upsertBskyInteraction({
        uri: announcementUri,
        subjectUri: articleUri,
        subjectCid: announcementCid,
        authorDid: did,
        action: "reply", // 便宜上replyとして扱うか、独自のフラグを立てる
        createdAt: now,
      });
      
      broadcasted = 1;
    }
  }

  const updatedFile = await updateWorkspaceFileById(fileId, did, {
    linkedArticleDid: targetDid,
    linkedArticleRkey: targetRkey,
    linkedArticleUri: articleUri,
  });

  return json({
    success: true,
    mode,
    did: targetDid,
    rkey: targetRkey,
    uri: articleUri,
    broadcasted,
    diagnostics: resolved.diagnostics,
    file: updatedFile,
  });
}

export async function handleWorkspaceImportResolve(request: Request): Promise<Response> {
  const did = await getDidOrLocal();
  const body = (await request.json()) as {
    sourceFormat?: unknown;
    text?: unknown;
  };

  const sourceFormat = sourceFormatFromUnknown(body.sourceFormat);
  const text = typeof body.text === "string" ? body.text : "";
  const resolved = await resolveWorkspaceImports({
    text,
    sourceFormat,
    resolveFileByPath: (path) => getWorkspaceFileByPath(path, did),
  });

  return json({
    success: true,
    resolvedText: resolved.resolvedText,
    diagnostics: resolved.diagnostics,
  });
}
