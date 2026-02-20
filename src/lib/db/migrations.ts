
import { Kysely, Migration, Migrator } from "kysely";
import { getDb } from ".";

const migrations: Record<string, Migration> = {
  "001": {
    async up(db: Kysely<unknown>) {
      await db.schema
        .createTable("auth_state")
        .addColumn("key", "text", (col) => col.primaryKey())
        .addColumn("value", "text", (col) => col.notNull())
        .execute();

      await db.schema
        .createTable("auth_session")
        .addColumn("key", "text", (col) => col.primaryKey())
        .addColumn("value", "text", (col) => col.notNull())
        .execute();
    },
    async down(db: Kysely<unknown>) {
      await db.schema.dropTable("auth_session").execute();
      await db.schema.dropTable("auth_state").execute();
    },
  },
  "002": {
    async up(db: Kysely<unknown>) {
      await db.schema
        .createTable("account")
        .addColumn("did", "text", (col) => col.primaryKey())
        .addColumn("handle", "text", (col) => col.notNull())
        .addColumn("active", "integer", (col) => col.notNull().defaultTo(1))
        .execute();

      await db.schema
        .createTable("article")
        .addColumn("uri", "text", (col) => col.primaryKey())
        .addColumn("authorDid", "text", (col) => col.notNull())
        .addColumn("title", "text", (col) => col.notNull())
        .addColumn("blocksJson", "text", (col) => col.notNull())
        .addColumn("createdAt", "text", (col) => col.notNull())
        .addColumn("indexedAt", "text", (col) => col.notNull())
        .execute();

      await db.schema
        .createTable("article_announcement")
        .addColumn("articleUri", "text", (col) => col.primaryKey())
        .addColumn("announcementUri", "text", (col) => col.notNull().unique())
        .addColumn("announcementCid", "text", (col) => col.notNull())
        .addColumn("authorDid", "text", (col) => col.notNull())
        .addColumn("createdAt", "text", (col) => col.notNull())
        .execute();

      await db.schema
        .createTable("inline_comment")
        .addColumn("uri", "text", (col) => col.primaryKey())
        .addColumn("articleUri", "text", (col) => col.notNull())
        .addColumn("authorDid", "text", (col) => col.notNull())
        .addColumn("text", "text", (col) => col.notNull())
        .addColumn("quote", "text", (col) => col.notNull())
        .addColumn("externalUri", "text", (col) => col.notNull())
        .addColumn("createdAt", "text", (col) => col.notNull())
        .addColumn("indexedAt", "text", (col) => col.notNull())
        .execute();

      await db.schema
        .createIndex("article_createdAt_idx")
        .on("article")
        .column("createdAt")
        .execute();

      await db.schema
        .createIndex("article_announcement_announcementUri_idx")
        .on("article_announcement")
        .column("announcementUri")
        .execute();

      await db.schema
        .createIndex("inline_comment_articleUri_createdAt_idx")
        .on("inline_comment")
        .columns(["articleUri", "createdAt"])
        .execute();

      await db.schema
        .createIndex("account_active_handle_idx")
        .on("account")
        .columns(["active", "handle"])
        .execute();
    },
    async down(db: Kysely<unknown>) {
      await db.schema.dropTable("inline_comment").execute();
      await db.schema.dropTable("article_announcement").execute();
      await db.schema.dropTable("article").execute();
      await db.schema.dropTable("account").execute();
    },
  },
  "003": {
    async up(db: Kysely<unknown>) {
      await db.schema
        .alterTable("article")
        .addColumn("sourceFormat", "text", (col) =>
          col.notNull().defaultTo("markdown"),
        )
        .execute();

      await db.schema
        .alterTable("article")
        .addColumn("broadcasted", "integer", (col) =>
          col.notNull().defaultTo(1),
        )
        .execute();

      await db.schema
        .createTable("draft_article")
        .addColumn("id", "text", (col) => col.primaryKey())
        .addColumn("title", "text", (col) => col.notNull())
        .addColumn("content", "text", (col) => col.notNull())
        .addColumn("sourceFormat", "text", (col) => col.notNull())
        .addColumn("createdAt", "text", (col) => col.notNull())
        .addColumn("updatedAt", "text", (col) => col.notNull())
        .execute();

      await db.schema
        .createIndex("draft_article_updatedAt_idx")
        .on("draft_article")
        .column("updatedAt")
        .execute();
    },
    async down(db: Kysely<unknown>) {
      await db.schema.dropTable("draft_article").execute();
    },
  },
};

export function getMigrator() {
  const db = getDb();
  return new Migrator({
    db,
    provider: {
      getMigrations: async () => migrations,
    },
  });
}
