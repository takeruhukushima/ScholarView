import { describe, it, expect } from 'vitest';
import {
  parseBibtexEntries,
  formatBibtexSource,
  extractCitationKeysFromText,
  formatCitationChip,
  formatBibliographyIEEE
} from '../citations';

describe('citations logic', () => {
  describe('parseBibtexEntries', () => {
    it('parses a single simple entry', () => {
      const input = `@article{key1, title = {Title One}, author = {Author A}, year = {2023}}`;
      const result = parseBibtexEntries(input);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        key: 'key1',
        title: 'Title One',
        author: 'Author A',
        year: '2023'
      });
    });

    it('parses entries with quotes instead of braces', () => {
      const input = `@article{key1, title = "Title One", author = "Author A", year = "2023"}`;
      const result = parseBibtexEntries(input);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Title One');
    });

    it('handles nested braces in fields (Note: current implementation limitation)', () => {
      const input = `@article{key1, title = {Title with {Nested} Braces}, author = {A. Author}}`;
      const result = parseBibtexEntries(input);
      expect(result).toHaveLength(1);
      // Current regex-based implementation stops at the first closing brace
      expect(result[0].title).toBe('Title with {Nested');
    });

    it('parses multiple entries and ignores non-bibtex text between them', () => {
      const input = `
        Some comment here.
        @article{key1, title = {T1}}
        Middle text.
        @book{key2, title = {T2}}
      `;
      const result = parseBibtexEntries(input);
      expect(result).toHaveLength(2);
      expect(result[0].key).toBe('key1');
      expect(result[1].key).toBe('key2');
    });

    it('handles duplicate keys by taking the first occurrence', () => {
      const input = `
        @article{dup, title = {First}}
        @article{dup, title = {Second}}
      `;
      const result = parseBibtexEntries(input);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('First');
    });

    it('handles malformed entries gracefully', () => {
      const input = `@article{incomplete, title = {Missing closing brace`;
      const result = parseBibtexEntries(input);
      expect(result).toHaveLength(0);
    });
  });

  describe('formatBibtexSource', () => {
    it('beautifies messy bibtex input', () => {
      const input = `@article{key1,title={Title},   author={A},year=2020}`;
      const formatted = formatBibtexSource(input);
      expect(formatted).toContain('  title  = {Title},');
      expect(formatted).toContain('  author = {A},');
    });

    it('preserves text between entries', () => {
      const input = `Comment
@article{k1, title={T1}}

More Comment
@article{k2, title={T2}}`;
      const formatted = formatBibtexSource(input);
      expect(formatted).toContain('Comment');
      expect(formatted).toContain('More Comment');
    });
  });

  describe('extractCitationKeysFromText', () => {
    it('extracts standard keys', () => {
      const text = "As seen in [@key1] and [@key2:2020].";
      const keys = extractCitationKeysFromText(text);
      expect(keys).toEqual(['key1', 'key2:2020']);
    });

    it('extracts latex cite keys', () => {
      const text = "As seen in \\cite{key1} and \\cite{key2:2020}.";
      const keys = extractCitationKeysFromText(text);
      expect(keys).toEqual(['key1', 'key2:2020']);
    });

    it('extracts multiple keys from a single latex cite', () => {
      const text = "Multiple: \\cite{Wu2003, Furusawa2007, Bachu2021}.";
      const keys = extractCitationKeysFromText(text);
      expect(keys).toEqual(['Wu2003', 'Furusawa2007', 'Bachu2021']);
    });

    it('handles keys with special characters', () => {
      const text = "[@author_name-2023] and [@org:project:v1]";
      const keys = extractCitationKeysFromText(text);
      expect(keys).toEqual(['author_name-2023', 'org:project:v1']);
    });

    it('excludes duplicates', () => {
      const text = "[@key1] and again [@key1]";
      const keys = extractCitationKeysFromText(text);
      expect(keys).toEqual(['key1']);
    });
  });

  describe('formatCitationChip', () => {
    it('formats with surname and year', () => {
      const entry = { key: 'k', rawBibtex: '', author: 'Doe, John', year: '2020' };
      expect(formatCitationChip(entry)).toBe('Doe, 2020');
    });

    it('handles "First Last" format', () => {
      const entry = { key: 'k', rawBibtex: '', author: 'John Doe', year: '2020' };
      expect(formatCitationChip(entry)).toBe('Doe, 2020');
    });

    it('falls back to key if author is missing', () => {
      const entry = { key: 'key123', rawBibtex: '', year: '2020' };
      expect(formatCitationChip(entry)).toBe('key123, 2020');
    });

    it('falls back to key if year is missing', () => {
      const entry = { key: 'key123', rawBibtex: '', author: 'Doe' };
      expect(formatCitationChip(entry)).toBe('key123');
    });
  });

  describe('formatBibliographyIEEE', () => {
    it('formats entries in IEEE style', () => {
      const entries = [
        { key: 'k1', rawBibtex: '', author: 'A. One', title: 'T1', year: '2020' },
        { key: 'k2', rawBibtex: '', author: 'B. Two and C. Three', title: 'T2', year: '2021' }
      ];
      const result = formatBibliographyIEEE(entries);
      expect(result[0]).toBe('[1] A. One, "T1", 2020.');
      expect(result[1]).toBe('[2] B. Two and C. Three, "T2", 2021.');
    });

    it('handles "et al." for many authors', () => {
      const entries = [
        { key: 'k1', rawBibtex: '', author: 'A. One and B. Two and C. Three and D. Four', title: 'T1', year: '2020' }
      ];
      const result = formatBibliographyIEEE(entries);
      expect(result[0]).toContain('A. One et al.');
    });
  });
});
