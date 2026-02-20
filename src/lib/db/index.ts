
import Database from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";

const DATABASE_PATH = process.env.DATABASE_PATH || "app.db";

let _db: Kysely<DatabaseSchema> | null = null;

export const getDb = (): Kysely<DatabaseSchema> => {
  if (!_db) {
    const sqlite = new Database(DATABASE_PATH);
    sqlite.pragma("journal_mode = WAL");

    _db = new Kysely<DatabaseSchema>({
      dialect: new SqliteDialect({ database: sqlite }),
    });
  }
  return _db;
};

export interface DatabaseSchema {
  auth_state: AuthStateTable;
  auth_session: AuthSessionTable;
  account: AccountTable;
  article: ArticleTable;
  article_announcement: ArticleAnnouncementTable;
  inline_comment: InlineCommentTable;
}

interface AuthStateTable {
  key: string;
  value: string;
}

interface AuthSessionTable {
  key: string;
  value: string;
}

export interface AccountTable {
  did: string;
  handle: string;
  active: 0 | 1;
}

export interface ArticleTable {
  uri: string;
  authorDid: string;
  title: string;
  blocksJson: string;
  createdAt: string;
  indexedAt: string;
}

export interface ArticleAnnouncementTable {
  articleUri: string;
  announcementUri: string;
  announcementCid: string;
  authorDid: string;
  createdAt: string;
}

export interface InlineCommentTable {
  uri: string;
  articleUri: string;
  authorDid: string;
  text: string;
  quote: string;
  externalUri: string;
  createdAt: string;
  indexedAt: string;
}
