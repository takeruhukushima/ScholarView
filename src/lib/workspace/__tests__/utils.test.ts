import { describe, it, expect, vi } from 'vitest';
import {
  newId,
  timeAgo,
  linkHref,
  referenceAnchorId
} from '../utils';

describe('workspace utils', () => {
  describe('newId', () => {
    it('generates a UUID if crypto is available', () => {
      const mockUuid = '1234-5678';
      vi.stubGlobal('crypto', { randomUUID: () => mockUuid });
      expect(newId()).toBe(mockUuid);
      vi.unstubAllGlobals();
    });

    it('falls back to timestamp if crypto is not available', () => {
      vi.stubGlobal('crypto', undefined);
      const id = newId();
      expect(id).toMatch(/^\d+-[a-f0-9]+$/);
      vi.unstubAllGlobals();
    });
  });

  describe('timeAgo', () => {
    it('returns "just now" for very recent dates', () => {
      const now = new Date().toISOString();
      expect(timeAgo(now)).toBe('just now');
    });

    it('returns minutes ago', () => {
      const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      expect(timeAgo(fiveMinsAgo)).toBe('5m');
    });

    it('returns hours ago', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      expect(timeAgo(twoHoursAgo)).toBe('2h');
    });

    it('returns days ago', () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      expect(timeAgo(threeDaysAgo)).toBe('3d');
    });
  });

  describe('linkHref', () => {
    it('validates http/https URLs', () => {
      expect(linkHref('https://example.com')).toBe('https://example.com/');
      expect(linkHref('http://example.com')).toBe('http://example.com/');
    });

    it('rejects other protocols', () => {
      expect(linkHref('javascript:alert(1)')).toBeNull();
      expect(linkHref('file:///etc/passwd')).toBeNull();
    });

    it('rejects invalid strings', () => {
      expect(linkHref('not a url')).toBeNull();
    });
  });

  describe('referenceAnchorId', () => {
    it('sanitizes keys for anchor IDs', () => {
      expect(referenceAnchorId('cite', 'doe:2020')).toBe('cite-doe-2020');
      expect(referenceAnchorId('ref', 'Smith & Jones')).toBe('ref-Smith-Jones');
    });
  });
});
