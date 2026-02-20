import {
  NodeOAuthClient,
  buildAtprotoLoopbackClientMetadata,
} from "@atproto/oauth-client-node";
import type {
  NodeSavedSession,
  NodeSavedState,
} from "@atproto/oauth-client-node";

import { getDb } from "../db";

export const SCOPE = "atproto repo:sci.peer.article repo:app.bsky.feed.post";

// Next.jsのホットリロードで消えないよう、globalThisを使います
const globalAuth = globalThis as unknown as {
  stateStore: Map<string, NodeSavedState>;
  sessionStore: Map<string, NodeSavedSession>;
};
globalAuth.stateStore ??= new Map();
globalAuth.sessionStore ??= new Map();

let client: NodeOAuthClient | null = null;

export async function getOAuthClient(): Promise<NodeOAuthClient> {
  if (client) return client;

  client = new NodeOAuthClient({
    clientMetadata: buildAtprotoLoopbackClientMetadata({
      scope: SCOPE,
      redirect_uris: ["http://127.0.0.1:3000/oauth/callback"],
    }),

    stateStore: {
      async get(key: string) {
        const db = getDb();
        const row = await db
          .selectFrom("auth_state")
          .select("value")
          .where("key", "=", key)
          .executeTakeFirst();
        return row ? JSON.parse(row.value) : undefined;
      },
      async set(key: string, value: NodeSavedState) {
        const db = getDb();
        const valueJson = JSON.stringify(value);
        await db
        .insertInto("auth_state")
        .values({ key, value: valueJson })
        .onConflict((oc) => oc.column("key").doUpdateSet({ value: valueJson }))
        .execute();
      },
      async del(key: string) {
        const db = getDb();
        await db.deleteFrom("auth_state").where("key", "=", key).execute();
      },    
    },

    sessionStore: {
      async get(key: string) {
        const db = getDb();
        const row = await db
          .selectFrom("auth_session")
          .select("value")
          .where("key", "=", key)
          .executeTakeFirst();
        return row ? JSON.parse(row.value) : undefined;
      },
      async set(key: string, value: NodeSavedSession) {
        const db = getDb();
        const valueJson = JSON.stringify(value);
        await db
        .insertInto("auth_session")
        .values({ key, value: valueJson })
        .onConflict((oc) => oc.column("key").doUpdateSet({ value: valueJson }))
        .execute();    
      },

      async del(key: string) {
        const db = getDb();
        await db.deleteFrom("auth_session").where("key", "=", key).execute();
      },
    },

  });

  return client;
}
