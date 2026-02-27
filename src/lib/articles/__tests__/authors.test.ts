import { describe, it, expect } from 'vitest';
import { formatAuthors, parseAuthors } from '../authors';

describe('authors logic', () => {
  describe('parseAuthors', () => {
    it('parses simple names', () => {
      const input = `Alice, Bob; Charlie
Dave`;
      const result = parseAuthors(input);
      expect(result).toHaveLength(4);
      expect(result.map(a => a.name)).toEqual(['Alice', 'Bob', 'Charlie', 'Dave']);
    });

    it('extracts DIDs from angle brackets', () => {
      const input = "Alice <did:plc:123>";
      const result = parseAuthors(input);
      expect(result[0].name).toBe('Alice');
      expect(result[0].did).toBe('did:plc:123');
    });

    it('extracts affiliations from parentheses', () => {
      const input = "Bob (University of X)";
      const result = parseAuthors(input);
      expect(result[0].name).toBe('Bob');
      expect(result[0].affiliation).toBe('University of X');
    });

    it('extracts both DID and affiliation', () => {
      const input = "Charlie <did:plc:456> (Lab Y)";
      const result = parseAuthors(input);
      expect(result[0].name).toBe('Charlie');
      expect(result[0].did).toBe('did:plc:456');
      expect(result[0].affiliation).toBe('Lab Y');
    });
  });

  describe('formatAuthors', () => {
    it('formats authors back to string', () => {
      const authors = [
        { name: 'Alice', did: 'did:1', affiliation: 'Aff1' },
        { name: 'Bob' }
      ];
      const result = formatAuthors(authors);
      expect(result).toBe("Alice <did:1> (Aff1)\nBob");
    });
  });
});
