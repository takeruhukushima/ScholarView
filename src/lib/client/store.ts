"use client";

import {
  deserializeBlocks,
  serializeBlocks,
  type ArticleBlock,
} from "@/lib/articles/blocks";
import {
  deserializeBibliography,
  serializeBibliography,
  type BibliographyEntry,
} from "@/lib/articles/citations";
import { buildArticleUri, parseArticleUri } from "@/lib/articles/uri";
import type {
  ArticleAuthor,
  ArticleDetail,
  ArticleSummary,
  BskyInteractionView,
  DraftArticle,
  InlineCommentView,
  SourceFormat,
  WorkspaceFileKind,
  WorkspaceFileNode,
} from "@/lib/types";

const DB_NAME = "scholarview-client-db";
const DB_VERSION = 1;

const STORE_ACCOUNTS = "accounts";
const STORE_ARTICLES = "articles";
const STORE_ANNOUNCEMENTS = "announcements";
const STORE_INLINE_COMMENTS = "inline_comments";
const STORE_DRAFTS = "drafts";
const STORE_WORKSPACE_FILES = "workspace_files";
const STORE_INTERACTIONS = "interactions";

interface AccountRecord {
  did: string;
  handle: string;
  active: 0 | 1;
}

interface ArticleRecord {
  uri: string;
  authorDid: string;
  title: string;
  authorsJson: string;
  blocksJson: string;
  bibliographyJson: string;
  imagesJson?: string;
  sourceFormat: SourceFormat;
  broadcasted: 0 | 1;
  createdAt: string;
  indexedAt: string;
}

interface AnnouncementRecord {
  articleUri: string;
  announcementUri: string;
  announcementCid: string;
  authorDid: string;
  createdAt: string;
}

interface InlineCommentRecord {
  uri: string;
  articleUri: string;
  authorDid: string;
  text: string;
  quote: string;
  externalUri: string;
  createdAt: string;
  indexedAt: string;
}

type DraftRecord = DraftArticle;

type WorkspaceFileRecord = WorkspaceFileNode;

type InteractionRecord = BskyInteractionView;

type StoreName =
  | typeof STORE_ACCOUNTS
  | typeof STORE_ARTICLES
  | typeof STORE_ANNOUNCEMENTS
  | typeof STORE_INLINE_COMMENTS
  | typeof STORE_DRAFTS
  | typeof STORE_WORKSPACE_FILES
  | typeof STORE_INTERACTIONS;

let dbPromise: Promise<IDBDatabase> | null = null;

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
  });
}

function ensureStore(db: IDBDatabase, name: StoreName, keyPath: string) {
  if (!db.objectStoreNames.contains(name)) {
    db.createObjectStore(name, { keyPath });
  }
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      ensureStore(db, STORE_ACCOUNTS, "did");
      ensureStore(db, STORE_ARTICLES, "uri");
      ensureStore(db, STORE_ANNOUNCEMENTS, "articleUri");
      ensureStore(db, STORE_INLINE_COMMENTS, "uri");
      ensureStore(db, STORE_DRAFTS, "id");
      ensureStore(db, STORE_WORKSPACE_FILES, "id");
      ensureStore(db, STORE_INTERACTIONS, "uri");
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to open IndexedDB database"));
  });

  return dbPromise;
}

async function transact<T>(
  stores: StoreName[],
  mode: IDBTransactionMode,
  run: (tx: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  const db = await openDb();
  const tx = db.transaction(stores, mode);
  try {
    const result = await run(tx);
    await transactionDone(tx);
    return result;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      // ignore abort failures
    }
    throw error;
  }
}

function normalizeSourceFormat(input: unknown): SourceFormat {
  return input === "tex" ? "tex" : "markdown";
}

function compareIsoDesc(a: string, b: string): number {
  return b.localeCompare(a);
}

function compareIsoAsc(a: string, b: string): number {
  return a.localeCompare(b);
}

function mapSummary(
  article: ArticleRecord,
  announcement: AnnouncementRecord | undefined,
  account: AccountRecord | undefined,
): ArticleSummary | null {
  const parsed = parseArticleUri(article.uri);
  if (!parsed) return null;

  let authors: ArticleAuthor[] = [];
  try {
    authors = article.authorsJson ? JSON.parse(article.authorsJson) : [];
  } catch {
    authors = [];
  }

  return {
    uri: article.uri,
    did: parsed.did,
    rkey: parsed.rkey,
    authorDid: article.authorDid,
    handle: account?.handle ?? null,
    title: article.title,
    authors,
    sourceFormat: normalizeSourceFormat(article.sourceFormat),
    broadcasted: article.broadcasted,
    createdAt: article.createdAt,
    announcementUri: announcement?.announcementUri ?? null,
  };
}

export async function upsertAccount(input: AccountRecord): Promise<void> {
  await transact([STORE_ACCOUNTS], "readwrite", async (tx) => {
    const store = tx.objectStore(STORE_ACCOUNTS);
    await requestToPromise(store.put(input));
  });
}

export async function getAccountHandle(did: string): Promise<string | null> {
  return transact([STORE_ACCOUNTS], "readonly", async (tx) => {
    const account = (await requestToPromise(
      tx.objectStore(STORE_ACCOUNTS).get(did),
    )) as AccountRecord | undefined;
    return account?.handle ?? null;
  });
}

export async function upsertArticle(input: ArticleRecord): Promise<void> {
  await transact([STORE_ARTICLES], "readwrite", async (tx) => {
    await requestToPromise(tx.objectStore(STORE_ARTICLES).put(input));
  });
}

export async function updateArticleByUri(
  uri: string,
  input: {
    title: string;
    authorsJson: string;
    blocksJson: string;
    bibliographyJson: string;
    imagesJson?: string;
    sourceFormat: SourceFormat;
    indexedAt: string;
    broadcasted?: 0 | 1;
  },
): Promise<void> {
  await transact([STORE_ARTICLES], "readwrite", async (tx) => {
    const store = tx.objectStore(STORE_ARTICLES);
    const current = (await requestToPromise(store.get(uri))) as ArticleRecord | undefined;
    if (!current) return;

    const next: ArticleRecord = {
      ...current,
      title: input.title,
      authorsJson: input.authorsJson,
      blocksJson: input.blocksJson,
      bibliographyJson: input.bibliographyJson,
      imagesJson: input.imagesJson ?? current.imagesJson,
      sourceFormat: input.sourceFormat,
      indexedAt: input.indexedAt,
      broadcasted: input.broadcasted ?? current.broadcasted,
    };

    await requestToPromise(store.put(next));
  });
}

export async function getArticleOwnerDid(uri: string): Promise<string | null> {
  return transact([STORE_ARTICLES], "readonly", async (tx) => {
    const article = (await requestToPromise(
      tx.objectStore(STORE_ARTICLES).get(uri),
    )) as ArticleRecord | undefined;
    return article?.authorDid ?? null;
  });
}

export async function deleteArticleCascade(
  uri: string,
): Promise<{ announcementUri: string; announcementCid: string } | null> {
  return transact(
    [STORE_ARTICLES, STORE_ANNOUNCEMENTS, STORE_INLINE_COMMENTS],
    "readwrite",
    async (tx) => {
      const announcementStore = tx.objectStore(STORE_ANNOUNCEMENTS);
      const commentStore = tx.objectStore(STORE_INLINE_COMMENTS);
      const articleStore = tx.objectStore(STORE_ARTICLES);

      const announcement = (await requestToPromise(
        announcementStore.get(uri),
      )) as AnnouncementRecord | undefined;

      const comments = (await requestToPromise(
        commentStore.getAll(),
      )) as InlineCommentRecord[];
      for (const comment of comments) {
        if (comment.articleUri === uri) {
          await requestToPromise(commentStore.delete(comment.uri));
        }
      }

      await requestToPromise(announcementStore.delete(uri));
      await requestToPromise(articleStore.delete(uri));

      return announcement
        ? {
            announcementUri: announcement.announcementUri,
            announcementCid: announcement.announcementCid,
          }
        : null;
    },
  );
}

export async function upsertArticleAnnouncement(input: AnnouncementRecord): Promise<void> {
  await transact([STORE_ANNOUNCEMENTS], "readwrite", async (tx) => {
    await requestToPromise(tx.objectStore(STORE_ANNOUNCEMENTS).put(input));
  });
}

export async function getAnnouncementByArticleUri(
  articleUri: string,
): Promise<AnnouncementRecord | null> {
  return transact([STORE_ANNOUNCEMENTS], "readonly", async (tx) => {
    const record = (await requestToPromise(
      tx.objectStore(STORE_ANNOUNCEMENTS).get(articleUri),
    )) as AnnouncementRecord | undefined;
    return record ?? null;
  });
}

export async function getAnnouncementByUri(
  announcementUri: string,
): Promise<AnnouncementRecord | null> {
  return transact([STORE_ANNOUNCEMENTS], "readonly", async (tx) => {
    const records = (await requestToPromise(
      tx.objectStore(STORE_ANNOUNCEMENTS).getAll(),
    )) as AnnouncementRecord[];
    return records.find((record) => record.announcementUri === announcementUri) ?? null;
  });
}

export async function deleteAnnouncementByUri(announcementUri: string): Promise<void> {
  await transact(
    [STORE_ANNOUNCEMENTS, STORE_INLINE_COMMENTS],
    "readwrite",
    async (tx) => {
      const announcementStore = tx.objectStore(STORE_ANNOUNCEMENTS);
      const commentStore = tx.objectStore(STORE_INLINE_COMMENTS);

      const records = (await requestToPromise(
        announcementStore.getAll(),
      )) as AnnouncementRecord[];
      const target = records.find((record) => record.announcementUri === announcementUri);
      if (!target) return;

      await requestToPromise(announcementStore.delete(target.articleUri));
      const comments = (await requestToPromise(commentStore.getAll())) as InlineCommentRecord[];
      for (const comment of comments) {
        if (comment.articleUri === target.articleUri) {
          await requestToPromise(commentStore.delete(comment.uri));
        }
      }
    },
  );
}

export async function upsertInlineComment(input: InlineCommentRecord): Promise<void> {
  await transact([STORE_INLINE_COMMENTS], "readwrite", async (tx) => {
    await requestToPromise(tx.objectStore(STORE_INLINE_COMMENTS).put(input));
  });
}

export async function deleteInlineComment(uri: string): Promise<void> {
  await transact([STORE_INLINE_COMMENTS], "readwrite", async (tx) => {
    await requestToPromise(tx.objectStore(STORE_INLINE_COMMENTS).delete(uri));
  });
}

export async function getRecentArticles(
  limit = 20,
  queryText?: string,
): Promise<ArticleSummary[]> {
  return transact(
    [STORE_ARTICLES, STORE_ANNOUNCEMENTS, STORE_ACCOUNTS],
    "readonly",
    async (tx) => {
      const [articles, announcements, accounts] = await Promise.all([
        requestToPromise(tx.objectStore(STORE_ARTICLES).getAll()) as Promise<ArticleRecord[]>,
        requestToPromise(tx.objectStore(STORE_ANNOUNCEMENTS).getAll()) as Promise<
          AnnouncementRecord[]
        >,
        requestToPromise(tx.objectStore(STORE_ACCOUNTS).getAll()) as Promise<AccountRecord[]>,
      ]);

      const q = queryText?.trim().toLowerCase();
      const announcementByArticle = new Map(
        announcements.map((announcement) => [announcement.articleUri, announcement]),
      );
      const accountByDid = new Map(accounts.map((account) => [account.did, account]));

      const filtered = q
        ? articles.filter(
            (article) =>
              article.title.toLowerCase().includes(q) ||
              article.blocksJson.toLowerCase().includes(q),
          )
        : articles;

      return filtered
        .sort((a, b) => compareIsoDesc(a.createdAt, b.createdAt))
        .slice(0, limit)
        .map((article) =>
          mapSummary(
            article,
            announcementByArticle.get(article.uri),
            accountByDid.get(article.authorDid),
          ),
        )
        .filter((item): item is ArticleSummary => item !== null);
    },
  );
}

export async function getArticleByDidAndRkey(
  did: string,
  rkey: string,
): Promise<ArticleDetail | null> {
  const uri = buildArticleUri(did, rkey);

  return transact(
    [STORE_ARTICLES, STORE_ANNOUNCEMENTS, STORE_ACCOUNTS],
    "readonly",
    async (tx) => {
      const article = (await requestToPromise(
        tx.objectStore(STORE_ARTICLES).get(uri),
      )) as ArticleRecord | undefined;
      if (!article) return null;

      const announcement = (await requestToPromise(
        tx.objectStore(STORE_ANNOUNCEMENTS).get(uri),
      )) as AnnouncementRecord | undefined;
      const account = (await requestToPromise(
        tx.objectStore(STORE_ACCOUNTS).get(article.authorDid),
      )) as AccountRecord | undefined;

      let authors: ArticleAuthor[] = [];
      try {
        authors = article.authorsJson ? JSON.parse(article.authorsJson) : [];
      } catch {
        authors = [];
      }

      let images: ArticleDetail["images"] = [];
      try {
        images = article.imagesJson ? JSON.parse(article.imagesJson) : [];
      } catch {
        images = [];
      }

      return {
        uri: article.uri,
        did,
        rkey,
        authorDid: article.authorDid,
        handle: account?.handle ?? null,
        title: article.title,
        authors,
        blocks: deserializeBlocks(article.blocksJson),
        bibliography: deserializeBibliography(article.bibliographyJson),
        images,
        sourceFormat: normalizeSourceFormat(article.sourceFormat),
        broadcasted: article.broadcasted,
        createdAt: article.createdAt,
        announcementUri: announcement?.announcementUri ?? null,
        announcementCid: announcement?.announcementCid ?? null,
      };
    },
  );
}

export async function getInlineCommentsByArticle(
  articleUri: string,
  limit = 200,
): Promise<InlineCommentView[]> {
  return transact([STORE_INLINE_COMMENTS, STORE_ACCOUNTS], "readonly", async (tx) => {
    const [comments, accounts] = await Promise.all([
      requestToPromise(tx.objectStore(STORE_INLINE_COMMENTS).getAll()) as Promise<
        InlineCommentRecord[]
      >,
      requestToPromise(tx.objectStore(STORE_ACCOUNTS).getAll()) as Promise<AccountRecord[]>,
    ]);

    const accountByDid = new Map(accounts.map((account) => [account.did, account]));
    return comments
      .filter((comment) => comment.articleUri === articleUri)
      .sort((a, b) => compareIsoAsc(a.createdAt, b.createdAt))
      .slice(0, limit)
      .map((comment) => ({
        uri: comment.uri,
        articleUri: comment.articleUri,
        authorDid: comment.authorDid,
        handle: accountByDid.get(comment.authorDid)?.handle ?? null,
        text: comment.text,
        quote: comment.quote,
        externalUri: comment.externalUri,
        createdAt: comment.createdAt,
      }));
  });
}

export async function listWorkspaceFiles(ownerDid: string): Promise<WorkspaceFileNode[]> {
  return transact([STORE_WORKSPACE_FILES], "readonly", async (tx) => {
    const records = (await requestToPromise(
      tx.objectStore(STORE_WORKSPACE_FILES).getAll(),
    )) as WorkspaceFileRecord[];

    return records
      .filter((record) => record.ownerDid === ownerDid)
      .sort((a, b) => {
        const parentA = a.parentId ?? "";
        const parentB = b.parentId ?? "";
        if (parentA !== parentB) return parentA.localeCompare(parentB);
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.name.localeCompare(b.name);
      });
  });
}

export async function getWorkspaceFileById(
  id: string,
  ownerDid: string,
): Promise<WorkspaceFileNode | null> {
  return transact([STORE_WORKSPACE_FILES], "readonly", async (tx) => {
    const file = (await requestToPromise(
      tx.objectStore(STORE_WORKSPACE_FILES).get(id),
    )) as WorkspaceFileRecord | undefined;
    if (!file || file.ownerDid !== ownerDid) return null;
    return file;
  });
}

export async function createWorkspaceFile(input: {
  ownerDid: string;
  parentId: string | null;
  name: string;
  kind: WorkspaceFileKind;
  sourceFormat?: SourceFormat | null;
  content?: string | null;
}): Promise<WorkspaceFileNode> {
  return transact([STORE_WORKSPACE_FILES], "readwrite", async (tx) => {
    const store = tx.objectStore(STORE_WORKSPACE_FILES);
    const all = (await requestToPromise(store.getAll())) as WorkspaceFileRecord[];

    const siblingCount = all.filter(
      (file) => file.ownerDid === input.ownerDid && file.parentId === input.parentId,
    ).length;

    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const file: WorkspaceFileRecord = {
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
      sortOrder: siblingCount,
      expanded: 1,
      createdAt: now,
      updatedAt: now,
    };
    await requestToPromise(store.put(file));
    return file;
  });
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
  return transact([STORE_WORKSPACE_FILES], "readwrite", async (tx) => {
    const store = tx.objectStore(STORE_WORKSPACE_FILES);
    const current = (await requestToPromise(store.get(id))) as WorkspaceFileRecord | undefined;
    if (!current || current.ownerDid !== ownerDid) return null;

    const next: WorkspaceFileRecord = {
      ...current,
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
    };

    await requestToPromise(store.put(next));
    return next;
  });
}

export async function deleteWorkspaceFileById(id: string, ownerDid: string): Promise<void> {
  await transact([STORE_WORKSPACE_FILES], "readwrite", async (tx) => {
    const store = tx.objectStore(STORE_WORKSPACE_FILES);
    const all = (await requestToPromise(store.getAll())) as WorkspaceFileRecord[];
    const byParent = new Map<string, string[]>();

    for (const file of all) {
      if (file.ownerDid !== ownerDid || !file.parentId) continue;
      const list = byParent.get(file.parentId) ?? [];
      list.push(file.id);
      byParent.set(file.parentId, list);
    }

    const toDelete = new Set<string>();
    const stack = [id];
    while (stack.length > 0) {
      const target = stack.pop();
      if (!target || toDelete.has(target)) continue;
      toDelete.add(target);
      for (const child of byParent.get(target) ?? []) {
        stack.push(child);
      }
    }

    for (const fileId of toDelete) {
      const existing = all.find((file) => file.id === fileId && file.ownerDid === ownerDid);
      if (existing) {
        await requestToPromise(store.delete(fileId));
      }
    }
  });
}

export async function getWorkspaceFileByPath(
  path: string,
  ownerDid: string,
): Promise<WorkspaceFileNode | null> {
  const normalized = path.trim().replace(/\/+/g, "/");
  if (!normalized.startsWith("/")) return null;

  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  const files = await listWorkspaceFiles(ownerDid);
  let parentId: string | null = null;
  let current: WorkspaceFileNode | null = null;

  for (const segment of segments) {
    current =
      files.find(
        (file) =>
          file.ownerDid === ownerDid &&
          file.parentId === parentId &&
          file.name === segment,
      ) ?? null;
    if (!current) return null;
    parentId = current.id;
  }

  return current;
}

export async function getWorkspaceFileByLinkedArticleUri(
  linkedArticleUri: string,
  ownerDid: string,
): Promise<WorkspaceFileNode | null> {
  const files = await listWorkspaceFiles(ownerDid);
  return files.find((file) => file.linkedArticleUri === linkedArticleUri) ?? null;
}

export async function upsertBskyInteraction(input: InteractionRecord): Promise<void> {
  await transact([STORE_INTERACTIONS], "readwrite", async (tx) => {
    await requestToPromise(tx.objectStore(STORE_INTERACTIONS).put(input));
  });
}

export async function listBskyInteractionsBySubjects(
  subjectUris: string[],
  authorDid?: string,
): Promise<BskyInteractionView[]> {
  if (subjectUris.length === 0) return [];

  return transact([STORE_INTERACTIONS], "readonly", async (tx) => {
    const records = (await requestToPromise(
      tx.objectStore(STORE_INTERACTIONS).getAll(),
    )) as InteractionRecord[];

    return records.filter((record) => {
      if (!subjectUris.includes(record.subjectUri)) return false;
      if (authorDid && record.authorDid !== authorDid) return false;
      return true;
    });
  });
}

export async function saveDraft(input: {
  id?: string;
  title: string;
  content: string;
  sourceFormat: SourceFormat;
}): Promise<DraftArticle> {
  return transact([STORE_DRAFTS], "readwrite", async (tx) => {
    const store = tx.objectStore(STORE_DRAFTS);
    const now = new Date().toISOString();
    const id = input.id ?? crypto.randomUUID();
    const existing = (await requestToPromise(store.get(id))) as DraftRecord | undefined;

    const record: DraftRecord = {
      id,
      title: input.title,
      content: input.content,
      sourceFormat: normalizeSourceFormat(input.sourceFormat),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await requestToPromise(store.put(record));
    return record;
  });
}

export async function listDrafts(limit = 50): Promise<DraftArticle[]> {
  return transact([STORE_DRAFTS], "readonly", async (tx) => {
    const drafts = (await requestToPromise(tx.objectStore(STORE_DRAFTS).getAll())) as DraftRecord[];
    return drafts.sort((a, b) => compareIsoDesc(a.updatedAt, b.updatedAt)).slice(0, limit);
  });
}

export async function getDraftById(id: string): Promise<DraftArticle | null> {
  return transact([STORE_DRAFTS], "readonly", async (tx) => {
    const draft = (await requestToPromise(
      tx.objectStore(STORE_DRAFTS).get(id),
    )) as DraftRecord | undefined;
    return draft ?? null;
  });
}

export async function deleteDraftById(id: string): Promise<void> {
  await transact([STORE_DRAFTS], "readwrite", async (tx) => {
    await requestToPromise(tx.objectStore(STORE_DRAFTS).delete(id));
  });
}

export async function seedArticleFromRecord(input: {
  uri: string;
  authorDid: string;
  title: string;
  authors?: ArticleAuthor[];
  sourceFormat: SourceFormat;
  blocks: ArticleBlock[];
  bibliography?: BibliographyEntry[];
  images?: ArticleDetail["images"];
  createdAt: string;
  indexedAt?: string;
  broadcasted?: 0 | 1;
}): Promise<void> {
  await upsertArticle({
    uri: input.uri,
    authorDid: input.authorDid,
    title: input.title,
    authorsJson: JSON.stringify(input.authors ?? []),
    sourceFormat: input.sourceFormat,
    blocksJson: serializeBlocks(input.blocks),
    bibliographyJson: serializeBibliography(input.bibliography ?? []),
    imagesJson: JSON.stringify(input.images ?? []),
    createdAt: input.createdAt,
    indexedAt: input.indexedAt ?? input.createdAt,
    broadcasted: input.broadcasted ?? 0,
  });
}

export async function deleteAccount(did: string): Promise<void> {
  await transact(
    [
      STORE_ACCOUNTS,
      STORE_ARTICLES,
      STORE_ANNOUNCEMENTS,
      STORE_INLINE_COMMENTS,
      STORE_INTERACTIONS,
      STORE_WORKSPACE_FILES,
    ],
    "readwrite",
    async (tx) => {
      const articleStore = tx.objectStore(STORE_ARTICLES);
      const announcementStore = tx.objectStore(STORE_ANNOUNCEMENTS);
      const commentStore = tx.objectStore(STORE_INLINE_COMMENTS);
      const interactionStore = tx.objectStore(STORE_INTERACTIONS);
      const workspaceStore = tx.objectStore(STORE_WORKSPACE_FILES);
      const accountStore = tx.objectStore(STORE_ACCOUNTS);

      const [articles, announcements, comments, interactions, files] = await Promise.all([
        requestToPromise(articleStore.getAll()) as Promise<ArticleRecord[]>,
        requestToPromise(announcementStore.getAll()) as Promise<AnnouncementRecord[]>,
        requestToPromise(commentStore.getAll()) as Promise<InlineCommentRecord[]>,
        requestToPromise(interactionStore.getAll()) as Promise<InteractionRecord[]>,
        requestToPromise(workspaceStore.getAll()) as Promise<WorkspaceFileRecord[]>,
      ]);

      const myArticleUris = new Set(
        articles.filter((article) => article.authorDid === did).map((article) => article.uri),
      );

      for (const article of articles) {
        if (article.authorDid === did) {
          await requestToPromise(articleStore.delete(article.uri));
        }
      }
      for (const announcement of announcements) {
        if (announcement.authorDid === did || myArticleUris.has(announcement.articleUri)) {
          await requestToPromise(announcementStore.delete(announcement.articleUri));
        }
      }
      for (const comment of comments) {
        if (comment.authorDid === did || myArticleUris.has(comment.articleUri)) {
          await requestToPromise(commentStore.delete(comment.uri));
        }
      }
      for (const interaction of interactions) {
        if (interaction.authorDid === did) {
          await requestToPromise(interactionStore.delete(interaction.uri));
        }
      }
      for (const file of files) {
        if (file.ownerDid === did) {
          await requestToPromise(workspaceStore.delete(file.id));
        }
      }

      await requestToPromise(accountStore.delete(did));
    },
  );
}

export async function resolveSubjectCidByUri(subjectUri: string): Promise<string | null> {
  const comments = await transact([STORE_INLINE_COMMENTS], "readonly", async (tx) => {
    return (await requestToPromise(
      tx.objectStore(STORE_INLINE_COMMENTS).get(subjectUri),
    )) as InlineCommentRecord | undefined;
  });
  if (comments) return null;
  return null;
}

export type {
  AccountRecord,
  AnnouncementRecord,
  ArticleRecord,
  InlineCommentRecord,
  InteractionRecord,
  WorkspaceFileRecord,
};
