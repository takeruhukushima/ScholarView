import { randomUUID } from "node:crypto";

import { getHandle } from "@atproto/common-web";

import { deserializeBlocks, type ArticleBlock } from "@/lib/articles/blocks";
import { buildArticleUri, parseArticleUri } from "@/lib/articles/uri";
import { getTap } from "@/lib/tap";

import {
  getDb,
  type AccountTable,
  type ArticleAnnouncementTable,
  type ArticleTable,
  type DraftArticleTable,
  type InlineCommentTable,
  type SourceFormat,
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
      await tx.deleteFrom("article").where("authorDid", "=", did).execute();
      await tx.deleteFrom("account").where("did", "=", did).execute();
    });
}

export async function upsertArticle(data: ArticleTable) {
  await getDb()
    .insertInto("article")
    .values(data)
    .onConflict((oc) =>
      oc.column("uri").doUpdateSet({
        authorDid: data.authorDid,
        title: data.title,
        blocksJson: data.blocksJson,
        sourceFormat: data.sourceFormat,
        broadcasted: data.broadcasted,
        createdAt: data.createdAt,
        indexedAt: data.indexedAt,
      }),
    )
    .execute();
}

export async function updateArticleByUri(
  uri: string,
  input: {
    title: string;
    blocksJson: string;
    sourceFormat: SourceFormat;
    indexedAt: string;
  },
) {
  await getDb()
    .updateTable("article")
    .set({
      title: input.title,
      blocksJson: input.blocksJson,
      sourceFormat: input.sourceFormat,
      indexedAt: input.indexedAt,
    })
    .where("uri", "=", uri)
    .execute();
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

  const row = await getDb()
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

  if (!row) return null;

  return {
    uri: row.uri,
    did,
    rkey,
    authorDid: row.authorDid,
    handle: row.handle ?? null,
    title: row.title,
    blocks: deserializeBlocks(row.blocksJson),
    sourceFormat: normalizeSourceFormat(row.sourceFormat),
    broadcasted: row.broadcasted as 0 | 1,
    createdAt: row.createdAt,
    announcementUri: row.announcementUri ?? null,
    announcementCid: row.announcementCid ?? null,
  };
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
