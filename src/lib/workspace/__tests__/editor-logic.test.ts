import { describe, it, expect } from 'vitest';
import {
  inferSourceFormat,
  normalizeEditedBlockInput,
  sourceToEditorBlocks,
  editorBlocksToSource,
  detectCitationTrigger
} from '../editor-logic';

describe('editor-logic', () => {
  describe('detectCitationTrigger', () => {
    it('detects standard @ trigger', () => {
      const result = detectCitationTrigger('See @key', 8);
      expect(result).toMatchObject({ start: 4, query: 'key', format: 'bracket' });
    });

    it('detects @ trigger with bracket', () => {
      const result = detectCitationTrigger('See [@key', 9);
      expect(result).toMatchObject({ start: 4, query: 'key', format: 'bracket' });
    });

    it('detects \ trigger', () => {
      const result = detectCitationTrigger('See \\key', 8);
      expect(result).toMatchObject({ start: 4, query: 'key', format: 'latex' });
    });

    it('detects \cite{ trigger', () => {
      const result = detectCitationTrigger('See \\cite{key', 13);
      expect(result).toMatchObject({ start: 4, query: 'key', format: 'latex' });
    });

    it('detects trigger after comma in \cite{}', () => {
      const result = detectCitationTrigger('\\cite{key1, key2', 16);
      expect(result).toMatchObject({ start: 11, query: 'key2', format: 'latex-inline' });
    });

    it('does not trigger if already closed', () => {
      const result = detectCitationTrigger('\\cite{key1} ', 12);
      expect(result).toBeNull();
    });

    it('handles query with special characters', () => {
      const result = detectCitationTrigger('@key:2020', 9);
      expect(result).toMatchObject({ query: 'key:2020' });
    });

    it('stops on invalid characters in query', () => {
      const result = detectCitationTrigger('@key!', 5);
      expect(result).toBeNull();
    });
  });

  describe('inferSourceFormat', () => {
    it('infers tex for .tex files', () => {
      expect(inferSourceFormat('file.tex', null)).toBe('tex');
    });

    it('defaults to markdown', () => {
      expect(inferSourceFormat('file.txt', null)).toBe('markdown');
    });

    it('prefers current format if set', () => {
      expect(inferSourceFormat('file.tex', 'markdown')).toBe('markdown');
    });
  });

  describe('normalizeEditedBlockInput', () => {
    it('detects markdown headings', () => {
      const result = normalizeEditedBlockInput({ id: '1', kind: 'paragraph', text: '' }, '# Heading', 'markdown');
      expect(result.kind).toBe('h1');
      expect(result.text).toBe('Heading');
    });

    it('detects tex sections', () => {
      const result = normalizeEditedBlockInput({ id: '1', kind: 'paragraph', text: '' }, '\\section{Title}', 'tex');
      expect(result.kind).toBe('h1');
      expect(result.text).toBe('Title');
    });
  });

  describe('roundtrip source conversion', () => {
    it('converts markdown source to editor blocks and back', () => {
      const source = `# Title

Paragraph 1.

Paragraph 2.`;
      const blocks = sourceToEditorBlocks(source, 'markdown');
      expect(blocks).toHaveLength(3);
      expect(blocks[0].kind).toBe('h1');
      expect(blocks[1].text).toBe('Paragraph 1.');

      const output = editorBlocksToSource(blocks, 'markdown');
      expect(output).toBe(source);
    });

    it('converts tex source to editor blocks and back', () => {
      const source = `\\section{Title}

Paragraph 1.`;
      const blocks = sourceToEditorBlocks(source, 'tex');
      expect(blocks).toHaveLength(2);
      expect(blocks[0].kind).toBe('h1');

      const output = editorBlocksToSource(blocks, 'tex');
      expect(output).toBe(source);
    });
  });
});
