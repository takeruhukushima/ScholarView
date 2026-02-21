
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
  "004": {
    async up(db: Kysely<unknown>) {
      await db.schema
        .createTable("workspace_file")
        .addColumn("id", "text", (col) => col.primaryKey())
        .addColumn("parentId", "text")
        .addColumn("name", "text", (col) => col.notNull())
        .addColumn("kind", "text", (col) => col.notNull())
        .addColumn("sourceFormat", "text")
        .addColumn("content", "text")
        .addColumn("sortOrder", "integer", (col) => col.notNull().defaultTo(0))
        .addColumn("expanded", "integer", (col) => col.notNull().defaultTo(1))
        .addColumn("createdAt", "text", (col) => col.notNull())
        .addColumn("updatedAt", "text", (col) => col.notNull())
        .execute();

      await db.schema
        .createIndex("workspace_file_parent_sort_idx")
        .on("workspace_file")
        .columns(["parentId", "sortOrder"])
        .execute();

      await db.schema
        .createTable("bsky_interaction")
        .addColumn("uri", "text", (col) => col.primaryKey())
        .addColumn("subjectUri", "text", (col) => col.notNull())
        .addColumn("subjectCid", "text", (col) => col.notNull())
        .addColumn("authorDid", "text", (col) => col.notNull())
        .addColumn("action", "text", (col) => col.notNull())
        .addColumn("createdAt", "text", (col) => col.notNull())
        .execute();

      await db.schema
        .createIndex("bsky_interaction_subject_idx")
        .on("bsky_interaction")
        .columns(["subjectUri", "action", "authorDid"])
        .execute();
    },
    async down(db: Kysely<unknown>) {
      await db.schema.dropTable("bsky_interaction").execute();
      await db.schema.dropTable("workspace_file").execute();
    },
  },
  "005": {
    async up(db: Kysely<unknown>) {
      await db.schema
        .alterTable("workspace_file")
        .addColumn("ownerDid", "text", (col) => col.notNull().defaultTo("__legacy__"))
        .execute();

      await db.schema
        .createIndex("workspace_file_owner_parent_sort_idx")
        .on("workspace_file")
        .columns(["ownerDid", "parentId", "sortOrder"])
        .execute();
    },
    async down(db: Kysely<unknown>) {
      await db.schema.dropIndex("workspace_file_owner_parent_sort_idx").execute();
    },
  },
  "006": {
    async up(db: Kysely<unknown>) {
      await db.schema
        .alterTable("workspace_file")
        .addColumn("linkedArticleDid", "text")
        .execute();

      await db.schema
        .alterTable("workspace_file")
        .addColumn("linkedArticleRkey", "text")
        .execute();

      await db.schema
        .alterTable("workspace_file")
        .addColumn("linkedArticleUri", "text")
        .execute();

      await db.schema
        .createIndex("workspace_file_owner_linked_idx")
        .on("workspace_file")
        .columns(["ownerDid", "linkedArticleUri"])
        .execute();
    },
    async down(db: Kysely<unknown>) {
      await db.schema.dropIndex("workspace_file_owner_linked_idx").execute();
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
