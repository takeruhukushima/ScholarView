import { AtUri } from "@atproto/syntax";

export const ARTICLE_COLLECTION = "sci.peer.article";

export function buildArticleUri(did: string, rkey: string): string {
  return `at://${did}/${ARTICLE_COLLECTION}/${rkey}`;
}

export function buildPaperPath(did: string, rkey: string): string {
  const didParam = encodeURIComponent(did);
  const rkeyParam = encodeURIComponent(rkey);
  return `/paper/${didParam}/${rkeyParam}`;
}

export function buildPaperUrl(
  publicUrl: string,
  did: string,
  rkey: string,
  quote?: string,
): string {
  const base = new URL(buildPaperPath(did, rkey), publicUrl);
  if (quote) {
    base.searchParams.set("quote", quote);
  }
  return base.toString();
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
