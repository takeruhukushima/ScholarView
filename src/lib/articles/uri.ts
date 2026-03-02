import { AtUri } from "@atproto/syntax";

export const ARTICLE_COLLECTION = "sci.peer.article";

/**
 * Get the public base URL of the application.
 * Prioritizes NEXT_PUBLIC_PUBLIC_URL environment variable, 
 * then window.location.origin in the browser, 
 * and finally fallbacks to the production URL.
 */
export function getPublicBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_PUBLIC_URL) {
    return process.env.NEXT_PUBLIC_PUBLIC_URL.replace(/\/$/, "");
  }
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return "https://scholar-view.vercel.app";
}

export function buildArticleUri(did: string, rkey: string): string {
  return `at://${did}/${ARTICLE_COLLECTION}/${rkey}`;
}

export function buildArticlePath(did: string, rkey: string): string {
  return `/article/${did}/${rkey}`;
}

export function buildArticleEditPath(did: string, rkey: string): string {
  return `/article/${did}/${rkey}/edit`;
}

export function buildScholarViewArticleUrl(
  did: string,
  rkey: string,
  quote?: string,
): string {
  const url = new URL(buildArticlePath(did, rkey), getPublicBaseUrl());
  if (quote) {
    url.searchParams.set("quote", quote);
  }
  return url.toString();
}

export function buildArticleUrl(
  publicUrl: string,
  did: string,
  rkey: string,
  quote?: string,
): string {
  const base = new URL(buildArticlePath(did, rkey), publicUrl);
  if (quote) {
    base.searchParams.set("quote", quote);
  }
  return base.toString();
}

export function buildBskyPostUrl(uri: string): string | null {
  try {
    const atUri = new AtUri(uri);
    if (atUri.collection !== "app.bsky.feed.post") return null;
    return `https://bsky.app/profile/${atUri.hostname}/post/${atUri.rkey}`;
  } catch {
    return null;
  }
}

export function decodeRouteParam(value: string): string {
  return decodeURIComponent(value);
}

export function parseArticleUri(uri: string): { did: string; rkey: string } | null {
  try {
    const atUri = new AtUri(uri);
    if (atUri.collection !== ARTICLE_COLLECTION) return null;
    return {
      did: atUri.hostname,
      rkey: atUri.rkey,
    };
  } catch {
    return null;
  }
}

export function extractQuoteFromExternalUri(uri: string): string | null {
  try {
    const url = new URL(uri);
    const quote = url.searchParams.get("quote");
    if (!quote) return null;
    return quote;
  } catch {
    return null;
  }
}

export function extractDidAndRkey(query: string): { did: string; rkey: string } | null {
  const trimmed = query.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("at://")) {
    return parseArticleUri(trimmed);
  }

  try {
    const url = new URL(trimmed);
    const pathParts = url.pathname.split('/').filter(Boolean);
    if (pathParts.length >= 3 && pathParts[0] === 'article') {
      return { did: pathParts[1], rkey: pathParts[2] };
    }
  } catch {
    return null;
  }

  return null;
}
