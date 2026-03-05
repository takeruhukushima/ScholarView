"use client";

import { Client } from "@atproto/lex";
import { BrowserOAuthClient, buildLoopbackClientId } from "@atproto/oauth-client-browser";
import { GUEST_DID_PREFIX, getOrCreateGuestIdentity, clearGuestIdentity } from "@/lib/guest-identity";
import { migrateGuestData } from "@/lib/client/store";

const ACTIVE_DID_KEY = "scholarview:auth:active-did";
const HANDLE_KEY_PREFIX = "scholarview:auth:handle:";

export const OAUTH_SCOPE =
  "atproto " +
  "blob:*/* " +
  "repo:sci.peer.article?action=create&action=update&action=delete " +
  "repo:app.bsky.feed.post?action=create&action=delete " +
  "repo:app.bsky.feed.like?action=create " +
  "repo:app.bsky.feed.repost?action=create";
const REQUIRED_SCOPE_TOKENS = OAUTH_SCOPE.split(/\s+/).filter(Boolean);

type BrowserOAuthClientLike = {
  init: () => Promise<{ session: unknown; state?: string } | undefined>;
  signIn: (identifier: string, options?: Record<string, unknown>) => Promise<never>;
  restore: (did: string) => Promise<unknown>;
  addEventListener?: (
    type: string,
    listener: (event: Event | CustomEvent<{ sub?: string }>) => void,
  ) => void;
  revoke?: (did: string) => Promise<void>;
};

let clientPromise: Promise<BrowserOAuthClientLike> | null = null;
let activeDidMemory: string | null = null;

function buildLoopbackClientIdWithScope(scope: string): string {
  const base = buildLoopbackClientId(window.location);
  const url = new URL(base);
  url.searchParams.set("scope", scope);
  return url.toString();
}

function hasRequiredScopes(grantedScope: string): boolean {
  const granted = new Set(grantedScope.split(/\s+/).filter(Boolean));
  return REQUIRED_SCOPE_TOKENS.every((token) => granted.has(token));
}

async function sessionHasRequiredScopes(session: unknown): Promise<boolean> {
  if (!session || typeof session !== "object") return false;
  const withTokenInfo = session as {
    getTokenInfo?: (
      refresh?: boolean | "auto",
    ) => Promise<{ scope?: unknown } | null | undefined>;
  };
  if (typeof withTokenInfo.getTokenInfo !== "function") return false;

  try {
    const tokenInfo = await withTokenInfo.getTokenInfo(false);
    const grantedScope = typeof tokenInfo?.scope === "string" ? tokenInfo.scope : "";
    return hasRequiredScopes(grantedScope);
  } catch {
    return false;
  }
}

async function clearSession(client: BrowserOAuthClientLike, did: string | null): Promise<void> {
  if (did) {
    try {
      await client.revoke?.(did);
    } catch {
      // ignore
    }
  }
  if (!did || activeDidMemory === did) {
    activeDidMemory = null;
  }
  writeStoredDid(null);
}

function getClientIdUrl(): string {
  return new URL("/client-metadata.json", window.location.origin).toString();
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function getDidFromSession(session: unknown): string | null {
  if (!session || typeof session !== "object") return null;
  const candidate = session as { did?: unknown; sub?: unknown };
  if (typeof candidate.did === "string" && candidate.did) return candidate.did;
  if (typeof candidate.sub === "string" && candidate.sub) return candidate.sub;
  return null;
}

function readStoredDid(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACTIVE_DID_KEY);
}

function writeStoredDid(did: string | null) {
  if (typeof window === "undefined") return;
  if (did) {
    window.localStorage.setItem(ACTIVE_DID_KEY, did);
  } else {
    window.localStorage.removeItem(ACTIVE_DID_KEY);
  }
}

export function setActiveDidToGuest(did: string) {
  activeDidMemory = did;
  writeStoredDid(did);
}

function readHandle(did: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(`${HANDLE_KEY_PREFIX}${did}`);
}

function writeHandle(did: string, handle: string) {
  if (typeof window === "undefined") return;
  if (!handle.trim()) return;
  window.localStorage.setItem(`${HANDLE_KEY_PREFIX}${did}`, handle.trim());
}

async function createClient(): Promise<BrowserOAuthClientLike> {
  const Ctor = BrowserOAuthClient as unknown as {
    new (options: Record<string, unknown>): BrowserOAuthClientLike;
    load?: (options: Record<string, unknown>) => Promise<BrowserOAuthClientLike>;
  };

  const loopback = isLoopbackHost(window.location.hostname);
  const handleResolver = "https://bsky.social";
  const clientId = loopback ? buildLoopbackClientIdWithScope(OAUTH_SCOPE) : getClientIdUrl();
  const client = Ctor.load
    ? await Ctor.load({ clientId, handleResolver })
    : new Ctor(
        loopback
          ? {
              handleResolver,
              clientMetadata: undefined,
            }
          : {
              clientId,
              handleResolver,
            },
      );
  client.addEventListener?.("deleted", (event) => {
    const customEvent = event as CustomEvent<{ sub?: string }>;
    const deletedDid =
      typeof customEvent.detail?.sub === "string" ? customEvent.detail.sub : null;
    if (!deletedDid) return;

    if (deletedDid === activeDidMemory) {
      activeDidMemory = null;
      writeStoredDid(null);
    }
  });

  return client;
}

export async function getBrowserOAuthClient(): Promise<BrowserOAuthClientLike> {
  if (!clientPromise) {
    clientPromise = createClient();
  }
  return clientPromise;
}

async function getGuestSession(did: string): Promise<unknown | null> {
  try {
    const identity = await getOrCreateGuestIdentity();
    if (identity.did !== did) return null;

    return {
      did: identity.did,
      handle: "guest.local",
      fetchHandler: async () => {
        return new Response(JSON.stringify({ error: "Guest network access limited" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      },
    };
  } catch {
    return null;
  }
}

/**
 * 起動時に呼び出され、セッションを初期化します。
 * セッションがない場合は自動的にゲストIDを作成します。
 */
export async function initializeAuth(): Promise<{
  did: string;
  handle: string;
}> {
  const client = await getBrowserOAuthClient();
  const initResult = await client.init();
  let did = initResult ? getDidFromSession(initResult.session) : null;
  const initSessionValid =
    initResult && did ? await sessionHasRequiredScopes(initResult.session) : false;

  const storedDid = readStoredDid();

  if (did && initSessionValid) {
    // データ引き継ぎ (Migration)
    if (storedDid && storedDid.startsWith(GUEST_DID_PREFIX) && storedDid !== did) {
      console.log(`[Auth] Migrating guest data ${storedDid} -> ${did}`);
      try {
        await migrateGuestData(storedDid, did);
        clearGuestIdentity();
      } catch (err) {
        console.error("[Auth] Migration failed:", err);
      }
    }

    activeDidMemory = did;
    writeStoredDid(did);

    if (typeof initResult?.state === "string") {
      try {
        const parsed = JSON.parse(initResult.state) as { handle?: unknown };
        if (typeof parsed.handle === "string" && parsed.handle.trim()) {
          writeHandle(did, parsed.handle);
        }
      } catch {
        // ignore
      }
    }
  } else {
    // 正規セッションが無効な場合
    if (did && !initSessionValid) {
      await clearSession(client, did);
      did = null;
    }

    // 以前のセッション（ゲストまたは正規）の復元を試みる
    if (storedDid) {
      if (storedDid.startsWith(GUEST_DID_PREFIX)) {
        did = storedDid;
      } else {
        try {
          const restored = await client.restore(storedDid);
          const restoredDid = getDidFromSession(restored);
          if (restoredDid && (await sessionHasRequiredScopes(restored))) {
            did = restoredDid;
          } else {
            await clearSession(client, storedDid);
            did = null;
          }
        } catch {
          did = null;
        }
      }
    }

    // それでもIDがない場合は、自動的にゲストIDを作成（必須化）
    if (!did) {
      const identity = await getOrCreateGuestIdentity();
      did = identity.did;
    }

    activeDidMemory = did;
    writeStoredDid(did);
  }

  return {
    did,
    handle: did.startsWith(GUEST_DID_PREFIX) ? "guest.local" : (readHandle(did) ?? did),
  };
}

export async function signInWithHandle(handle: string): Promise<never> {
  const normalized = handle.trim();
  if (!normalized) throw new Error("Handle is required");
  const client = await getBrowserOAuthClient();
  return client.signIn(normalized, {
    prompt: "consent",
    scope: OAUTH_SCOPE,
    state: JSON.stringify({ handle: normalized }),
  });
}

export async function getActiveSession(): Promise<unknown | null> {
  let did = activeDidMemory ?? readStoredDid();
  
  if (!did) {
    const identity = await getOrCreateGuestIdentity();
    did = identity.did;
    activeDidMemory = did;
    writeStoredDid(did);
  }

  if (did.startsWith(GUEST_DID_PREFIX)) {
    return getGuestSession(did);
  }

  const client = await getBrowserOAuthClient();
  try {
    const session = await client.restore(did);
    if (await sessionHasRequiredScopes(session)) {
      activeDidMemory = getDidFromSession(session);
      writeStoredDid(activeDidMemory);
      return session;
    }
  } catch {
    // ignore
  }
  
  // フォールバック: 正式セッションが失敗したらゲストへ
  const identity = await getOrCreateGuestIdentity();
  activeDidMemory = identity.did;
  writeStoredDid(activeDidMemory);
  return getGuestSession(activeDidMemory);
}

export async function getActiveDid(): Promise<string> {
  const did = activeDidMemory ?? readStoredDid();
  if (did) return did;
  
  const identity = await getOrCreateGuestIdentity();
  activeDidMemory = identity.did;
  writeStoredDid(activeDidMemory);
  return activeDidMemory;
}

export async function getActiveHandle(): Promise<string> {
  const did = await getActiveDid();
  return did.startsWith(GUEST_DID_PREFIX) ? "guest.local" : (readHandle(did) ?? did);
}

export async function signOut(): Promise<void> {
  const did = await getActiveDid();
  if (did && !did.startsWith(GUEST_DID_PREFIX)) {
    const client = await getBrowserOAuthClient();
    try {
      await client.revoke?.(did);
    } catch {
      // ignore
    }
  }

  activeDidMemory = null;
  writeStoredDid(null);
  
  // ログアウトした瞬間、新しいゲストIDでリセットされる（実質的な匿名化）
  const identity = await getOrCreateGuestIdentity();
  activeDidMemory = identity.did;
  writeStoredDid(activeDidMemory);
}

export async function getLexClientForCurrentSession(): Promise<Client> {
  const session = await getActiveSession();
  return new Client(session as never);
}

export async function getSessionFetchHandler(): Promise<
  ((pathname: string, init?: RequestInit) => Promise<Response>) | null
> {
  const session = await getActiveSession();
  if (!session || typeof session !== "object") return null;

  const maybe = session as {
    fetchHandler?: (pathname: string, init?: RequestInit) => Promise<Response>;
  };
  if (typeof maybe.fetchHandler !== "function") return null;
  return maybe.fetchHandler.bind(session) as (
    pathname: string,
    init?: RequestInit,
  ) => Promise<Response>;
}
