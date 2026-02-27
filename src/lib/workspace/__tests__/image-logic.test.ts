import { describe, it, expect } from 'vitest';
import {
  sanitizeFileStem,
  inferImageExtension,
  createUniqueImageFileName,
  isImageFileName,
  parseMarkdownImageLine,
  imageAlignFromAttrs,
  rewriteImagePathReferencesInMarkdown,
  toFigureLabel
} from '../image-logic';

describe('image-logic', () => {
  describe('sanitizeFileStem', () => {
    it('cleans up filenames', () => {
      expect(sanitizeFileStem('My Image!.png')).toBe('My-Image');
      expect(sanitizeFileStem('  spaces and $$$  ')).toBe('spaces-and');
    });
  });

  describe('inferImageExtension', () => {
    it('infers from name', () => {
      expect(inferImageExtension('test.png', 'image/jpeg')).toBe('png');
    });

    it('infers from mime type if name has no extension', () => {
      expect(inferImageExtension('test', 'image/jpeg')).toBe('jpg');
      expect(inferImageExtension('test', 'image/png')).toBe('png');
    });
  });

  describe('createUniqueImageFileName', () => {
    it('returns base name if not taken', () => {
      const taken = new Set<string>();
      expect(createUniqueImageFileName('img', 'png', taken)).toBe('img.png');
    });

    it('adds suffix if taken', () => {
      const taken = new Set<string>(['img.png']);
      expect(createUniqueImageFileName('img', 'png', taken)).toBe('img-2.png');
    });
  });

  describe('isImageFileName', () => {
    it('detects image extensions', () => {
      expect(isImageFileName('test.png')).toBe(true);
      expect(isImageFileName('TEST.JPG')).toBe(true);
      expect(isImageFileName('doc.pdf')).toBe(false);
    });
  });

  describe('parseMarkdownImageLine', () => {
    it('parses image with alt and src', () => {
      const line = '![alt text](image.png)';
      expect(parseMarkdownImageLine(line)).toEqual({
        alt: 'alt text',
        rawSrc: 'image.png',
        attrs: ''
      });
    });

    it('parses image with attributes', () => {
      const line = '![alt](img.png){align=left}';
      expect(parseMarkdownImageLine(line)).toEqual({
        alt: 'alt',
        rawSrc: 'img.png',
        attrs: 'align=left'
      });
    });
  });

  describe('imageAlignFromAttrs', () => {
    it('extracts alignment', () => {
      expect(imageAlignFromAttrs('align=right class=foo')).toBe('right');
      expect(imageAlignFromAttrs('no align')).toBe('center');
    });
  });

  describe('rewriteImagePathReferencesInMarkdown', () => {
    const options = {
      movedFileId: 'f1',
      oldPath: '/old/img.png',
      newPath: '/new/img.png',
      documentPath: '/doc.md',
      resolveWorkspacePathFromDocument: (src: string) => src.startsWith('/') ? src : `/old/${src}`
    };

    it('rewrites path when old path matches', () => {
      const source = '![alt](img.png)';
      const result = rewriteImagePathReferencesInMarkdown(source, options);
      expect(result).toBe('![alt](/new/img.png)');
    });

    it('rewrites path when workspace ID matches', () => {
      const source = '![alt](workspace://f1)';
      const result = rewriteImagePathReferencesInMarkdown(source, options);
      expect(result).toBe('![alt](/new/img.png)');
    });

    it('does not rewrite unrelated paths', () => {
      const source = '![alt](/other/img.png)';
      const result = rewriteImagePathReferencesInMarkdown(source, options);
      expect(result).toBe('![alt](/other/img.png)');
    });
  });

  describe('toFigureLabel', () => {
    it('converts titles to labels', () => {
      expect(toFigureLabel('My Chart')).toBe('fig:my_chart');
      expect(toFigureLabel('Results 2023!!')).toBe('fig:results_2023');
    });
  });
});
