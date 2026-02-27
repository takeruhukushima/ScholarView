import { describe, it, expect } from 'vitest';
import {
  buildArticleUri,
  buildPaperPath,
  buildAtprotoAtArticleUrl,
  parseArticleUri,
  extractQuoteFromExternalUri
} from '../uri';

describe('uri logic', () => {
  const did = 'did:plc:123';
  const rkey = 'abc-123';

  describe('buildArticleUri', () => {
    it('builds correct at-uri', () => {
      expect(buildArticleUri(did, rkey)).toBe(`at://${did}/sci.peer.article/${rkey}`);
    });
  });

  describe('buildPaperPath', () => {
    it('builds internal path with query params', () => {
      const path = buildPaperPath(did, rkey);
      expect(path).toContain('/paper');
      expect(path).toContain('did=did%3Aplc%3A123');
      expect(path).toContain('rkey=abc-123');
    });
  });

  describe('buildAtprotoAtArticleUrl', () => {
    it('builds external viewer URL', () => {
      const url = buildAtprotoAtArticleUrl(did, rkey);
      expect(url).toContain('atproto.at/viewer');
      // All colons in DID are encoded as %3A
      const encodedDid = did.replaceAll(':', '%3A');
      expect(url).toContain(`uri=${encodedDid}%2Fsci.peer.article%2F${rkey}`);
    });

    it('includes quote if provided', () => {
      const url = buildAtprotoAtArticleUrl(did, rkey, 'my-quote');
      expect(url).toContain('quote=my-quote');
    });
  });

  describe('parseArticleUri', () => {
    it('parses valid article uri', () => {
      const uri = `at://${did}/sci.peer.article/${rkey}`;
      const result = parseArticleUri(uri);
      expect(result).toEqual({ did, rkey });
    });

    it('returns null for different collection', () => {
      const uri = `at://${did}/app.bsky.feed.post/${rkey}`;
      expect(parseArticleUri(uri)).toBeNull();
    });

    it('returns null for invalid uri', () => {
      expect(parseArticleUri('not-a-uri')).toBeNull();
    });
  });

  describe('extractQuoteFromExternalUri', () => {
    it('extracts quote from search params', () => {
      const uri = 'https://example.com/paper?quote=abc-123';
      expect(extractQuoteFromExternalUri(uri)).toBe('abc-123');
    });

    it('returns null if no quote', () => {
      const uri = 'https://example.com/paper';
      expect(extractQuoteFromExternalUri(uri)).toBeNull();
    });
  });
});
