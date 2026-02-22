"use client";

import { Client } from "@atproto/lex";
import { BrowserOAuthClient } from "@atproto/oauth-client-browser";

const ACTIVE_DID_KEY = "scholarview:auth:active-did";
const HANDLE_KEY_PREFIX = "scholarview:auth:handle:";

export const OAUTH_SCOPE = "atproto repo:sci.peer.article repo:app.bsky.feed.post";

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
  const options = loopback
    ? {
        // Loopback clients cannot use a path-based client_id during local dev.
        // The OAuth server provides built-in metadata for loopback origins.
        handleResolver: "https://bsky.social",
        clientMetadata: undefined,
      }
    : {
        clientId: getClientIdUrl(),
        handleResolver: "https://bsky.social",
      };

  const client = loopback
    ? new Ctor(options)
    : Ctor.load
      ? await Ctor.load(options)
      : new Ctor(options);
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

export async function initializeAuth(): Promise<{
  did: string | null;
  handle: string | null;
}> {
  const client = await getBrowserOAuthClient();
  const initResult = await client.init();
  let did = initResult ? getDidFromSession(initResult.session) : null;

  if (did) {
    activeDidMemory = did;
    writeStoredDid(did);

    if (typeof initResult?.state === "string") {
      try {
        const parsed = JSON.parse(initResult.state) as { handle?: unknown };
        if (typeof parsed.handle === "string" && parsed.handle.trim()) {
          writeHandle(did, parsed.handle);
        }
      } catch {
        // Ignore malformed state payload.
      }
    }
  } else {
    const storedDid = readStoredDid();
    if (storedDid) {
      try {
        const restored = await client.restore(storedDid);
        did = getDidFromSession(restored);
      } catch {
        did = null;
      }
    }

    activeDidMemory = did;
    writeStoredDid(did);
  }

  return {
    did,
    handle: did ? readHandle(did) : null,
  };
}

export async function signInWithHandle(handle: string): Promise<never> {
  const normalized = handle.trim();
  if (!normalized) {
    throw new Error("Handle is required");
  }

  const client = await getBrowserOAuthClient();
  return client.signIn(normalized, {
    state: JSON.stringify({ handle: normalized }),
  });
}

export async function getActiveSession(): Promise<unknown | null> {
  const client = await getBrowserOAuthClient();
  const did = activeDidMemory ?? readStoredDid();
  if (!did) return null;

  try {
    const session = await client.restore(did);
    activeDidMemory = getDidFromSession(session);
    writeStoredDid(activeDidMemory);
    return session;
  } catch {
    activeDidMemory = null;
    writeStoredDid(null);
    return null;
  }
}

export async function getActiveDid(): Promise<string | null> {
  const session = await getActiveSession();
  return getDidFromSession(session);
}

export async function getActiveHandle(): Promise<string | null> {
  const did = await getActiveDid();
  if (!did) return null;
  return readHandle(did);
}

export async function signOut(): Promise<void> {
  const did = await getActiveDid();
  if (did) {
    const client = await getBrowserOAuthClient();
    try {
      await client.revoke?.(did);
    } catch {
      // Token revocation can fail when session already invalidated.
    }
  }

  activeDidMemory = null;
  writeStoredDid(null);
}

export async function getLexClientForCurrentSession(): Promise<Client> {
  const session = await getActiveSession();
  if (!session) {
    throw new Error("Unauthorized");
  }
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
