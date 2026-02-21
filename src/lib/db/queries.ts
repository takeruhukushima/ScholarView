import { randomUUID } from "node:crypto";

import { getHandle } from "@atproto/common-web";
import { sql } from "kysely";

import { deserializeBlocks, type ArticleBlock } from "@/lib/articles/blocks";
import {
  deserializeBibliography,
  type BibliographyEntry,
} from "@/lib/articles/citations";
import { buildArticleUri, parseArticleUri } from "@/lib/articles/uri";
import { getTap } from "@/lib/tap";

import {
  type BskyInteractionAction,
  type BskyInteractionTable,
  getDb,
  type AccountTable,
  type ArticleAnnouncementTable,
  type ArticleTable,
  type DraftArticleTable,
  type InlineCommentTable,
  type SourceFormat,
  type WorkspaceFileKind,
  type WorkspaceFileTable,
} from ".";

export interface ArticleSummary {
  uri: string;
  did: string;
  rkey: string;
  authorDid: string;
  handle: string | null;
  title: string;
  sourceFormat: SourceFormat;
  broadcasted: 0 | 1;
  createdAt: string;
  announcementUri: string | null;
}

export interface ArticleDetail {
  uri: string;
  did: string;
  rkey: string;
  authorDid: string;
  handle: string | null;
  title: string;
  blocks: ArticleBlock[];
  bibliography: BibliographyEntry[];
  sourceFormat: SourceFormat;
  broadcasted: 0 | 1;
  createdAt: string;
  announcementUri: string | null;
  announcementCid: string | null;
}

export interface InlineCommentView {
  uri: string;
  articleUri: string;
  authorDid: string;
  handle: string | null;
  text: string;
  quote: string;
  externalUri: string;
  createdAt: string;
}

export type DraftArticle = DraftArticleTable;

export interface WorkspaceFileNode {
  id: string;
  parentId: string | null;
  name: string;
  kind: WorkspaceFileKind;
  sourceFormat: SourceFormat | null;
  content: string | null;
  linkedArticleDid: string | null;
  linkedArticleRkey: string | null;
  linkedArticleUri: string | null;
  sortOrder: number;
  expanded: 0 | 1;
  createdAt: string;
  updatedAt: string;
}

export interface BskyInteractionView {
  uri: string;
  subjectUri: string;
  subjectCid: string;
  authorDid: string;
  action: BskyInteractionAction;
  createdAt: string;
}

export async function upsertAccount(data: AccountTable) {
  await getDb()
    .insertInto("account")
    .values(data)
    .onConflict((oc) =>
      oc.column("did").doUpdateSet({
        handle: data.handle,
        active: data.active,
      }),
    )
    .execute();
}

export async function deleteAccount(did: string) {
  await getDb()
    .transaction()
    .execute(async (tx) => {
      const authoredArticles = await tx
        .selectFrom("article")
        .select("uri")
        .where("authorDid", "=", did)
        .execute();
      const articleUris = authoredArticles.map((row) => row.uri);

      if (articleUris.length > 0) {
        await tx
          .deleteFrom("inline_comment")
          .where("articleUri", "in", articleUris)
          .execute();
        await tx
          .deleteFrom("article_announcement")
          .where("articleUri", "in", articleUris)
          .execute();
      }

      await tx
        .deleteFrom("article_announcement")
        .where("authorDid", "=", did)
        .execute();
      await tx
        .deleteFrom("inline_comment")
        .where("authorDid", "=", did)
        .execute();
      await tx
        .deleteFrom("bsky_interaction")
        .where("authorDid", "=", did)
        .execute();
      await tx
        .deleteFrom("workspace_file")
        .where("ownerDid", "=", did)
        .execute();
      await tx.deleteFrom("article").where("authorDid", "=", did).execute();
      await tx.deleteFrom("account").where("did", "=", did).execute();
    });
}

export async function upsertArticle(data: ArticleTable) {
  try {
    await getDb()
      .insertInto("article")
      .values(data)
      .onConflict((oc) =>
        oc.column("uri").doUpdateSet({
          authorDid: data.authorDid,
          title: data.title,
          blocksJson: data.blocksJson,
          bibliographyJson: data.bibliographyJson,
          sourceFormat: data.sourceFormat,
          broadcasted: data.broadcasted,
          createdAt: data.createdAt,
          indexedAt: data.indexedAt,
        }),
      )
      .execute();
  } catch (err: unknown) {
    if (!isMissingBibliographyColumnError(err)) {
      throw err;
    }

    await sql`
      insert into article (
        uri, authorDid, title, blocksJson, sourceFormat, broadcasted, createdAt, indexedAt
      ) values (
        ${data.uri}, ${data.authorDid}, ${data.title}, ${data.blocksJson},
        ${data.sourceFormat}, ${data.broadcasted}, ${data.createdAt}, ${data.indexedAt}
      )
      on conflict(uri) do update set
        authorDid = excluded.authorDid,
        title = excluded.title,
        blocksJson = excluded.blocksJson,
        sourceFormat = excluded.sourceFormat,
        broadcasted = excluded.broadcasted,
        createdAt = excluded.createdAt,
        indexedAt = excluded.indexedAt
    `.execute(getDb());
  }
}

export async function updateArticleByUri(
  uri: string,
  input: {
    title: string;
    blocksJson: string;
    bibliographyJson: string;
    sourceFormat: SourceFormat;
    indexedAt: string;
    broadcasted?: 0 | 1;
  },
) {
  const next: {
    title: string;
    blocksJson: string;
    bibliographyJson: string;
    sourceFormat: SourceFormat;
    indexedAt: string;
    broadcasted?: 0 | 1;
  } = {
    title: input.title,
    blocksJson: input.blocksJson,
    bibliographyJson: input.bibliographyJson,
    sourceFormat: input.sourceFormat,
    indexedAt: input.indexedAt,
  };
  if (input.broadcasted !== undefined) {
    next.broadcasted = input.broadcasted;
  }

  try {
    await getDb()
      .updateTable("article")
      .set(next)
      .where("uri", "=", uri)
      .execute();
  } catch (err: unknown) {
    if (!isMissingBibliographyColumnError(err)) {
      throw err;
    }

    const fallback: {
      title: string;
      blocksJson: string;
      sourceFormat: SourceFormat;
      indexedAt: string;
      broadcasted?: 0 | 1;
    } = {
      title: input.title,
      blocksJson: input.blocksJson,
      sourceFormat: input.sourceFormat,
      indexedAt: input.indexedAt,
    };
    if (input.broadcasted !== undefined) {
      fallback.broadcasted = input.broadcasted;
    }

    await getDb()
      .updateTable("article")
      .set(fallback)
      .where("uri", "=", uri)
      .execute();
  }
}

export async function getArticleOwnerDid(uri: string): Promise<string | null> {
  const row = await getDb()
    .selectFrom("article")
    .select("authorDid")
    .where("uri", "=", uri)
    .executeTakeFirst();

  return row?.authorDid ?? null;
}

export async function deleteArticleCascade(uri: string) {
  return getDb()
    .transaction()
    .execute(async (tx) => {
      const announcement = await tx
        .selectFrom("article_announcement")
        .select(["announcementUri", "announcementCid"])
        .where("articleUri", "=", uri)
        .executeTakeFirst();

      await tx
        .deleteFrom("inline_comment")
        .where("articleUri", "=", uri)
        .execute();
      await tx
        .deleteFrom("article_announcement")
        .where("articleUri", "=", uri)
        .execute();
      await tx.deleteFrom("article").where("uri", "=", uri).execute();

      return announcement ?? null;
    });
}

export async function upsertArticleAnnouncement(data: ArticleAnnouncementTable) {
  await getDb()
    .insertInto("article_announcement")
    .values(data)
    .onConflict((oc) =>
      oc.column("articleUri").doUpdateSet({
        announcementUri: data.announcementUri,
        announcementCid: data.announcementCid,
        authorDid: data.authorDid,
        createdAt: data.createdAt,
      }),
    )
    .execute();
}

export async function getAnnouncementByArticleUri(articleUri: string) {
  return getDb()
    .selectFrom("article_announcement")
    .selectAll()
    .where("articleUri", "=", articleUri)
    .executeTakeFirst();
}

export async function getAnnouncementByUri(announcementUri: string) {
  return getDb()
    .selectFrom("article_announcement")
    .selectAll()
    .where("announcementUri", "=", announcementUri)
    .executeTakeFirst();
}

export async function deleteAnnouncementByUri(announcementUri: string) {
  const announcement = await getAnnouncementByUri(announcementUri);
  if (!announcement) return;

  await getDb()
    .transaction()
    .execute(async (tx) => {
      await tx
        .deleteFrom("article_announcement")
        .where("announcementUri", "=", announcementUri)
        .execute();
      await tx
        .deleteFrom("inline_comment")
        .where("articleUri", "=", announcement.articleUri)
        .execute();
    });
}

export async function upsertInlineComment(data: InlineCommentTable) {
  await getDb()
    .insertInto("inline_comment")
    .values(data)
    .onConflict((oc) =>
      oc.column("uri").doUpdateSet({
        articleUri: data.articleUri,
        authorDid: data.authorDid,
        text: data.text,
        quote: data.quote,
        externalUri: data.externalUri,
        createdAt: data.createdAt,
        indexedAt: data.indexedAt,
      }),
    )
    .execute();
}

export async function deleteInlineComment(uri: string) {
  await getDb().deleteFrom("inline_comment").where("uri", "=", uri).execute();
}

function normalizeSourceFormat(value: string): SourceFormat {
  return value === "tex" ? "tex" : "markdown";
}

export async function getRecentArticles(
  limit = 20,
  queryText?: string,
): Promise<ArticleSummary[]> {
  const db = getDb();
  const normalizedQuery = queryText?.trim();

  const query = db
    .selectFrom("article")
    .leftJoin("account", "account.did", "article.authorDid")
    .leftJoin("article_announcement", "article_announcement.articleUri", "article.uri")
    .select([
      "article.uri as uri",
      "article.authorDid as authorDid",
      "article.title as title",
      "article.sourceFormat as sourceFormat",
      "article.broadcasted as broadcasted",
      "article.createdAt as createdAt",
      "account.handle as handle",
      "article_announcement.announcementUri as announcementUri",
    ])
    .orderBy("article.createdAt", "desc")
    .limit(limit);

  const rows =
    normalizedQuery && normalizedQuery.length > 0
      ? await query
          .where((eb) =>
            eb.or([
              eb("article.title", "like", `%${normalizedQuery}%`),
              eb("article.blocksJson", "like", `%${normalizedQuery}%`),
            ]),
          )
          .execute()
      : await query.execute();

  return rows
    .map((row) => {
      const parsed = parseArticleUri(row.uri);
      if (!parsed) return null;

      return {
        uri: row.uri,
        did: parsed.did,
        rkey: parsed.rkey,
        authorDid: row.authorDid,
        handle: row.handle ?? null,
        title: row.title,
        sourceFormat: normalizeSourceFormat(row.sourceFormat),
        broadcasted: row.broadcasted as 0 | 1,
        createdAt: row.createdAt,
        announcementUri: row.announcementUri ?? null,
      };
    })
    .filter((row): row is ArticleSummary => row !== null);
}

export async function getArticleByDidAndRkey(
  did: string,
  rkey: string,
): Promise<ArticleDetail | null> {
  const uri = buildArticleUri(did, rkey);

  let row:
    | {
        uri: string;
        authorDid: string;
        title: string;
        blocksJson: string;
        bibliographyJson?: string | null;
        sourceFormat: string;
        broadcasted: number;
        createdAt: string;
        handle: string | null;
        announcementUri: string | null;
        announcementCid: string | null;
      }
    | undefined;

  try {
    row = await getDb()
      .selectFrom("article")
      .leftJoin("account", "account.did", "article.authorDid")
      .leftJoin("article_announcement", "article_announcement.articleUri", "article.uri")
      .select([
        "article.uri as uri",
        "article.authorDid as authorDid",
        "article.title as title",
        "article.blocksJson as blocksJson",
        "article.bibliographyJson as bibliographyJson",
        "article.sourceFormat as sourceFormat",
        "article.broadcasted as broadcasted",
        "article.createdAt as createdAt",
        "account.handle as handle",
        "article_announcement.announcementUri as announcementUri",
        "article_announcement.announcementCid as announcementCid",
      ])
      .where("article.uri", "=", uri)
      .executeTakeFirst();
  } catch (err: unknown) {
    if (!isMissingBibliographyColumnError(err)) {
      throw err;
    }

    row = await getDb()
      .selectFrom("article")
      .leftJoin("account", "account.did", "article.authorDid")
      .leftJoin("article_announcement", "article_announcement.articleUri", "article.uri")
      .select([
        "article.uri as uri",
        "article.authorDid as authorDid",
        "article.title as title",
        "article.blocksJson as blocksJson",
        "article.sourceFormat as sourceFormat",
        "article.broadcasted as broadcasted",
        "article.createdAt as createdAt",
        "account.handle as handle",
        "article_announcement.announcementUri as announcementUri",
        "article_announcement.announcementCid as announcementCid",
      ])
      .where("article.uri", "=", uri)
      .executeTakeFirst();
  }

  if (!row) return null;

  return {
    uri: row.uri,
    did,
    rkey,
    authorDid: row.authorDid,
    handle: row.handle ?? null,
    title: row.title,
    blocks: deserializeBlocks(row.blocksJson),
    bibliography: deserializeBibliography(row.bibliographyJson ?? "[]"),
    sourceFormat: normalizeSourceFormat(row.sourceFormat),
    broadcasted: row.broadcasted as 0 | 1,
    createdAt: row.createdAt,
    announcementUri: row.announcementUri ?? null,
    announcementCid: row.announcementCid ?? null,
  };
}

function isMissingBibliographyColumnError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /no such column:\s*article\.bibliographyJson|no such column:\s*bibliographyJson/i.test(
    err.message,
  );
}

export async function getInlineCommentsByArticle(
  articleUri: string,
  limit = 200,
): Promise<InlineCommentView[]> {
  const rows = await getDb()
    .selectFrom("inline_comment")
    .leftJoin("account", "account.did", "inline_comment.authorDid")
    .select([
      "inline_comment.uri as uri",
      "inline_comment.articleUri as articleUri",
      "inline_comment.authorDid as authorDid",
      "inline_comment.text as text",
      "inline_comment.quote as quote",
      "inline_comment.externalUri as externalUri",
      "inline_comment.createdAt as createdAt",
      "account.handle as handle",
    ])
    .where("inline_comment.articleUri", "=", articleUri)
    .orderBy("inline_comment.createdAt", "asc")
    .limit(limit)
    .execute();

  return rows.map((row) => ({
    uri: row.uri,
    articleUri: row.articleUri,
    authorDid: row.authorDid,
    handle: row.handle ?? null,
    text: row.text,
    quote: row.quote,
    externalUri: row.externalUri,
    createdAt: row.createdAt,
  }));
}

export async function getInlineCommentsByArticleAndQuote(
  articleUri: string,
  quote: string,
  limit = 200,
): Promise<InlineCommentView[]> {
  const normalizedQuote = quote.trim();
  if (!normalizedQuote) {
    return getInlineCommentsByArticle(articleUri, limit);
  }

  const rows = await getDb()
    .selectFrom("inline_comment")
    .leftJoin("account", "account.did", "inline_comment.authorDid")
    .select([
      "inline_comment.uri as uri",
      "inline_comment.articleUri as articleUri",
      "inline_comment.authorDid as authorDid",
      "inline_comment.text as text",
      "inline_comment.quote as quote",
      "inline_comment.externalUri as externalUri",
      "inline_comment.createdAt as createdAt",
      "account.handle as handle",
    ])
    .where("inline_comment.articleUri", "=", articleUri)
    .where("inline_comment.quote", "like", `%${normalizedQuote}%`)
    .orderBy("inline_comment.createdAt", "asc")
    .limit(limit)
    .execute();

  return rows.map((row) => ({
    uri: row.uri,
    articleUri: row.articleUri,
    authorDid: row.authorDid,
    handle: row.handle ?? null,
    text: row.text,
    quote: row.quote,
    externalUri: row.externalUri,
    createdAt: row.createdAt,
  }));
}

function normalizeWorkspaceFile(row: WorkspaceFileTable): WorkspaceFileNode {
  return {
    id: row.id,
    parentId: row.parentId,
    name: row.name,
    kind: row.kind === "folder" ? "folder" : "file",
    sourceFormat: row.sourceFormat ? normalizeSourceFormat(row.sourceFormat) : null,
    content: row.content,
    linkedArticleDid: row.linkedArticleDid,
    linkedArticleRkey: row.linkedArticleRkey,
    linkedArticleUri: row.linkedArticleUri,
    sortOrder: row.sortOrder,
    expanded: row.expanded,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listWorkspaceFiles(ownerDid: string): Promise<WorkspaceFileNode[]> {
  const rows = await getDb()
    .selectFrom("workspace_file")
    .selectAll()
    .where("ownerDid", "=", ownerDid)
    .orderBy("parentId", "asc")
    .orderBy("sortOrder", "asc")
    .orderBy("name", "asc")
    .execute();

  return rows.map((row) => normalizeWorkspaceFile(row));
}

export async function getWorkspaceFileById(
  id: string,
  ownerDid: string,
): Promise<WorkspaceFileNode | null> {
  const row = await getDb()
    .selectFrom("workspace_file")
    .selectAll()
    .where("id", "=", id)
    .where("ownerDid", "=", ownerDid)
    .executeTakeFirst();

  if (!row) return null;
  return normalizeWorkspaceFile(row);
}

export async function createWorkspaceFile(input: {
  ownerDid: string;
  parentId: string | null;
  name: string;
  kind: WorkspaceFileKind;
  sourceFormat?: SourceFormat | null;
  content?: string | null;
}): Promise<WorkspaceFileNode> {
  const now = new Date().toISOString();
  const id = randomUUID();
  const siblingCountQuery = getDb()
    .selectFrom("workspace_file")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where("ownerDid", "=", input.ownerDid);
  const siblingCount = await (input.parentId
    ? siblingCountQuery.where("parentId", "=", input.parentId).executeTakeFirstOrThrow()
    : siblingCountQuery.where("parentId", "is", null).executeTakeFirstOrThrow());

  const row: WorkspaceFileTable = {
    ownerDid: input.ownerDid,
    id,
    parentId: input.parentId,
    name: input.name,
    kind: input.kind,
    sourceFormat: input.kind === "file" ? (input.sourceFormat ?? "markdown") : null,
    content: input.kind === "file" ? (input.content ?? "") : null,
    linkedArticleDid: null,
    linkedArticleRkey: null,
    linkedArticleUri: null,
    sortOrder: Number(siblingCount.count) || 0,
    expanded: 1,
    createdAt: now,
    updatedAt: now,
  };

  await getDb().insertInto("workspace_file").values(row).execute();
  return normalizeWorkspaceFile(row);
}

export async function updateWorkspaceFileById(
  id: string,
  ownerDid: string,
  input: {
    parentId?: string | null;
    name?: string;
    content?: string;
    sortOrder?: number;
    expanded?: 0 | 1;
    sourceFormat?: SourceFormat;
    linkedArticleDid?: string | null;
    linkedArticleRkey?: string | null;
    linkedArticleUri?: string | null;
  },
): Promise<WorkspaceFileNode | null> {
  const current = await getWorkspaceFileById(id, ownerDid);
  if (!current) return null;

  await getDb()
    .updateTable("workspace_file")
    .set({
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(input.expanded !== undefined ? { expanded: input.expanded } : {}),
      ...(input.sourceFormat !== undefined ? { sourceFormat: input.sourceFormat } : {}),
      ...(input.linkedArticleDid !== undefined
        ? { linkedArticleDid: input.linkedArticleDid }
        : {}),
      ...(input.linkedArticleRkey !== undefined
        ? { linkedArticleRkey: input.linkedArticleRkey }
        : {}),
      ...(input.linkedArticleUri !== undefined
        ? { linkedArticleUri: input.linkedArticleUri }
        : {}),
      updatedAt: new Date().toISOString(),
    })
    .where("id", "=", id)
    .where("ownerDid", "=", ownerDid)
    .execute();

  return getWorkspaceFileById(id, ownerDid);
}

export async function deleteWorkspaceFileById(id: string, ownerDid: string): Promise<void> {
  const all = await getDb()
    .selectFrom("workspace_file")
    .select(["id", "parentId"])
    .where("ownerDid", "=", ownerDid)
    .execute();
  const children = new Map<string, string[]>();
  for (const row of all) {
    if (!row.parentId) continue;
    const list = children.get(row.parentId) ?? [];
    list.push(row.id);
    children.set(row.parentId, list);
  }

  const toDelete = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    const target = stack.pop();
    if (!target || toDelete.has(target)) continue;
    toDelete.add(target);
    const next = children.get(target) ?? [];
    for (const child of next) stack.push(child);
  }

  if (toDelete.size === 0) return;
  await getDb()
    .deleteFrom("workspace_file")
    .where("id", "in", Array.from(toDelete))
    .where("ownerDid", "=", ownerDid)
    .execute();
}

export async function getWorkspaceFileByPath(
  path: string,
  ownerDid: string,
): Promise<WorkspaceFileNode | null> {
  const normalized = path.trim().replace(/\/+/g, "/");
  if (!normalized.startsWith("/")) return null;

  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  let parentId: string | null = null;
  let current: WorkspaceFileNode | null = null;

  for (const segment of segments) {
    const query = getDb()
      .selectFrom("workspace_file")
      .selectAll()
      .where("ownerDid", "=", ownerDid)
      .where("name", "=", segment);
    const row = parentId
      ? await query.where("parentId", "=", parentId).executeTakeFirst()
      : await query.where("parentId", "is", null).executeTakeFirst();
    if (!row) return null;
    current = normalizeWorkspaceFile(row);
    parentId = current.id;
  }

  return current;
}

export async function getWorkspaceFileByLinkedArticleUri(
  linkedArticleUri: string,
  ownerDid: string,
): Promise<WorkspaceFileNode | null> {
  const row = await getDb()
    .selectFrom("workspace_file")
    .selectAll()
    .where("ownerDid", "=", ownerDid)
    .where("linkedArticleUri", "=", linkedArticleUri)
    .executeTakeFirst();

  if (!row) return null;
  return normalizeWorkspaceFile(row);
}

export async function upsertBskyInteraction(data: BskyInteractionTable): Promise<void> {
  await getDb()
    .insertInto("bsky_interaction")
    .values(data)
    .onConflict((oc) =>
      oc.column("uri").doUpdateSet({
        subjectUri: data.subjectUri,
        subjectCid: data.subjectCid,
        authorDid: data.authorDid,
        action: data.action,
        createdAt: data.createdAt,
      }),
    )
    .execute();
}

export async function listBskyInteractionsBySubjects(
  subjectUris: string[],
  authorDid?: string,
): Promise<BskyInteractionView[]> {
  if (subjectUris.length === 0) return [];

  const query = getDb()
    .selectFrom("bsky_interaction")
    .selectAll()
    .where("subjectUri", "in", subjectUris);

  const rows =
    authorDid && authorDid.trim()
      ? await query.where("authorDid", "=", authorDid).execute()
      : await query.execute();

  return rows.map((row) => ({
    uri: row.uri,
    subjectUri: row.subjectUri,
    subjectCid: row.subjectCid,
    authorDid: row.authorDid,
    action: row.action === "like" ? "like" : row.action === "repost" ? "repost" : "reply",
    createdAt: row.createdAt,
  }));
}

export async function getAccountHandle(did: string): Promise<string | null> {
  const account = await getDb()
    .selectFrom("account")
    .select("handle")
    .where("did", "=", did)
    .executeTakeFirst();

  if (account?.handle) return account.handle;

  try {
    const didDoc = await getTap().resolveDid(did);
    if (!didDoc) return null;
    return getHandle(didDoc) ?? null;
  } catch {
    return null;
  }
}

export async function saveDraft(input: {
  id?: string;
  title: string;
  content: string;
  sourceFormat: SourceFormat;
}): Promise<DraftArticle> {
  const now = new Date().toISOString();
  const id = input.id ?? randomUUID();

  const row: DraftArticleTable = {
    id,
    title: input.title,
    content: input.content,
    sourceFormat: input.sourceFormat,
    createdAt: now,
    updatedAt: now,
  };

  await getDb()
    .insertInto("draft_article")
    .values(row)
    .onConflict((oc) =>
      oc.column("id").doUpdateSet({
        title: row.title,
        content: row.content,
        sourceFormat: row.sourceFormat,
        updatedAt: row.updatedAt,
      }),
    )
    .execute();

  const saved = await getDb()
    .selectFrom("draft_article")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirstOrThrow();

  return {
    ...saved,
    sourceFormat: normalizeSourceFormat(saved.sourceFormat),
  };
}

export async function listDrafts(limit = 50): Promise<DraftArticle[]> {
  const rows = await getDb()
    .selectFrom("draft_article")
    .selectAll()
    .orderBy("updatedAt", "desc")
    .limit(limit)
    .execute();

  return rows.map((row) => ({
    ...row,
    sourceFormat: normalizeSourceFormat(row.sourceFormat),
  }));
}

export async function getDraftById(id: string): Promise<DraftArticle | null> {
  const row = await getDb()
    .selectFrom("draft_article")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();

  if (!row) return null;
  return {
    ...row,
    sourceFormat: normalizeSourceFormat(row.sourceFormat),
  };
}

export async function deleteDraftById(id: string): Promise<void> {
  await getDb().deleteFrom("draft_article").where("id", "=", id).execute();
}
