import { describe, it, expect } from 'vitest';
import {
  buildArticleUri,
  buildArticlePath,
  buildScholarViewArticleUrl,
  buildBskyPostUrl,
  parseArticleUri,
  extractQuoteFromExternalUri,
  extractDidAndRkey,
  getPublicBaseUrl
} from '../uri';

describe('uri logic', () => {
  const did = 'did:plc:123';
  const rkey = 'abc-123';

  describe('buildArticleUri', () => {
    it('builds correct at-uri', () => {
      expect(buildArticleUri(did, rkey)).toBe(`at://${did}/sci.peer.article/${rkey}`);
    });
  });

  describe('buildArticlePath', () => {
    it('builds internal path with dynamic segments', () => {
      const path = buildArticlePath(did, rkey);
      expect(path).toBe(`/article/${did}/${rkey}`);
    });
  });

  describe('buildScholarViewArticleUrl', () => {
    it('builds external viewer URL', () => {
      const url = buildScholarViewArticleUrl(did, rkey);
      const baseUrl = getPublicBaseUrl();
      expect(url).toBe(`${baseUrl}/article/${did}/${rkey}`);
    });

    it('includes quote if provided', () => {
      const url = buildScholarViewArticleUrl(did, rkey, 'my-quote');
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
      const uri = 'https://example.com/article/did/rkey?quote=abc-123';
      expect(extractQuoteFromExternalUri(uri)).toBe('abc-123');
    });

    it('returns null if no quote', () => {
      const uri = 'https://example.com/article/did/rkey';
      expect(extractQuoteFromExternalUri(uri)).toBeNull();
    });
  });

  describe('extractDidAndRkey', () => {
    it('extracts from AT URI', () => {
      const query = `at://${did}/sci.peer.article/${rkey}`;
      expect(extractDidAndRkey(query)).toEqual({ did, rkey });
    });

    it('extracts from ScholarView URL', () => {
      const query = `https://scholar-view.vercel.app/article/${did}/${rkey}`;
      expect(extractDidAndRkey(query)).toEqual({ did, rkey });
    });

    it('returns null for random text', () => {
      expect(extractDidAndRkey('hello world')).toBeNull();
    });
  });

  describe('buildBskyPostUrl', () => {
    it('converts valid post AT URI to bsky.app URL', () => {
      const uri = 'at://did:plc:123/app.bsky.feed.post/abc';
      expect(buildBskyPostUrl(uri)).toBe('https://bsky.app/profile/did:plc:123/post/abc');
    });

    it('returns null for non-post collection', () => {
      const uri = 'at://did:plc:123/sci.peer.article/abc';
      expect(buildBskyPostUrl(uri)).toBeNull();
    });

    it('returns null for invalid URI', () => {
      expect(buildBskyPostUrl('not-a-uri')).toBeNull();
    });
  });
});
