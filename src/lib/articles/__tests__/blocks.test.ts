import { describe, it, expect } from 'vitest';
import {
  parseMarkdownToBlocks,
  parseTexToBlocks,
  normalizeBlocks,
  serializeBlocks,
  deserializeBlocks
} from '../blocks';

describe('blocks logic', () => {
  describe('parseMarkdownToBlocks', () => {
    it('parses standard headings', () => {
      const markdown = `
# Title
Content 1
## Subtitle
Content 2
      `.trim();
      const blocks = parseMarkdownToBlocks(markdown);
      expect(blocks).toHaveLength(2);
      expect(blocks[0].heading).toBe('Title');
      expect(blocks[0].level).toBe(1);
      expect(blocks[0].content).toBe('Content 1');
      expect(blocks[1].heading).toBe('Subtitle');
      expect(blocks[1].level).toBe(2);
      expect(blocks[1].content).toBe('Content 2');
    });

    it('defaults to Section 1 for content without heading', () => {
      const markdown = `Just some text here.`;
      const blocks = parseMarkdownToBlocks(markdown);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].heading).toBe('Section 1');
      expect(blocks[0].content).toBe('Just some text here.');
    });

    it('clumps levels correctly via normalizeBlocks', () => {
      // parseMarkdownToBlocks only supports 1-6 via regex
      const markdown = `# Level 1\n\n###### Level 6`;
      const blocks = parseMarkdownToBlocks(markdown);
      expect(blocks[0].level).toBe(1);
      expect(blocks[1].level).toBe(6);
      
      // Manual test of normalizeBlock level clamping
      const normalized = normalizeBlocks([{ level: 0, heading: 'H', content: 'C' }, { level: 7, heading: 'H', content: 'C' }]);
      expect(normalized[0].level).toBe(1);
      expect(normalized[1].level).toBe(6);
    });

    it('handles headings with no content', () => {
      const markdown = `# Empty Heading`;
      const blocks = parseMarkdownToBlocks(markdown);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].heading).toBe('Empty Heading');
      expect(blocks[0].content).toBe('');
    });
  });

  describe('parseTexToBlocks', () => {
    it('parses standard sectioning commands', () => {
      const tex = `
\\section{Introduction}
Text A
\\subsection{Method}
Text B
\\subsubsection{Detail}
Text C
      `.trim();
      const blocks = parseTexToBlocks(tex);
      expect(blocks).toHaveLength(3);
      expect(blocks[0].heading).toBe('Introduction');
      expect(blocks[0].level).toBe(1);
      expect(blocks[1].heading).toBe('Method');
      expect(blocks[1].level).toBe(2);
      expect(blocks[2].heading).toBe('Detail');
      expect(blocks[2].level).toBe(3);
    });

    it('handles multiple lines between sections', () => {
      const tex = `\\section{S1}
Line 1
Line 2
\\section{S2}
Line 3`;
      const blocks = parseTexToBlocks(tex);
      expect(blocks[0].content).toBe('Line 1\nLine 2');
    });
  });

  describe('normalizeBlocks', () => {
    it('enforces maximum heading and content lengths', () => {
      const longHeading = 'H'.repeat(1000);
      const longContent = 'C'.repeat(30000);
      const input = [{ level: 1, heading: longHeading, content: longContent }];
      const result = normalizeBlocks(input);
      expect(result[0].heading.length).toBe(200);
      expect(result[0].content.length).toBe(20000);
    });

    it('enforces maximum number of blocks', () => {
      const manyBlocks = Array.from({ length: 300 }, (_, i) => ({
        level: 1, heading: `S ${i}`, content: 'C'
      }));
      const result = normalizeBlocks(manyBlocks);
      expect(result).toHaveLength(200);
    });

    it('handles malformed input gracefully', () => {
      expect(normalizeBlocks(null)).toEqual([]);
    });
  });

  describe('serialization', () => {
    it('serializes and deserializes blocks correctly', () => {
      const blocks = [{ level: 1 as const, heading: 'H', content: 'C' }];
      const serialized = serializeBlocks(blocks);
      const deserialized = deserializeBlocks(serialized);
      expect(deserialized).toEqual(blocks);
    });

    it('handles invalid json during deserialization', () => {
      expect(deserializeBlocks('invalid json')).toEqual([]);
    });
  });
});
