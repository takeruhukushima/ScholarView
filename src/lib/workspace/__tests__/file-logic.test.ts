import { describe, it, expect } from 'vitest';
import {
  defaultTitleFromFileName,
  composeFileNameFromTitle,
  ensureFileExtension,
  normalizeWorkspacePath,
  dirnameWorkspacePath,
  makeFileTree
} from '../file-logic';
import { WorkspaceFile } from '../types';

describe('file-logic', () => {
  describe('defaultTitleFromFileName', () => {
    it('strips extension and trims', () => {
      expect(defaultTitleFromFileName('paper.md')).toBe('paper');
      expect(defaultTitleFromFileName('  my paper.tex  ')).toBe('my paper');
    });

    it('returns "Untitled" for empty names', () => {
      expect(defaultTitleFromFileName('.md')).toBe('Untitled');
    });
  });

  describe('composeFileNameFromTitle', () => {
    it('appends existing extension to new title', () => {
      expect(composeFileNameFromTitle('New Title', 'old.md')).toBe('New Title.md');
    });

    it('does not double extension', () => {
      expect(composeFileNameFromTitle('New Title.md', 'old.md')).toBe('New Title.md');
    });

    it('handles titles with different casing of extension', () => {
      expect(composeFileNameFromTitle('New Title.MD', 'old.md')).toBe('New Title.md');
    });
  });

  describe('ensureFileExtension', () => {
    it('adds .md by default', () => {
      expect(ensureFileExtension('file', 'markdown')).toBe('file.md');
    });

    it('adds .tex for tex type', () => {
      expect(ensureFileExtension('file', 'tex')).toBe('file.tex');
    });

    it('adds .bib for bib type', () => {
      expect(ensureFileExtension('file', 'bib')).toBe('file.bib');
    });

    it('does not add if already present', () => {
      expect(ensureFileExtension('file.tex', 'markdown')).toBe('file.tex');
    });
  });

  describe('workspace path operations', () => {
    it('normalizes paths', () => {
      expect(normalizeWorkspacePath('a//b/./c/../d')).toBe('/a/b/d');
      expect(normalizeWorkspacePath('')).toBe('/');
    });

    it('gets dirname', () => {
      expect(dirnameWorkspacePath('/a/b/c.md')).toBe('/a/b');
      expect(dirnameWorkspacePath('/a.md')).toBe('/');
    });
  });

  describe('makeFileTree', () => {
    it('builds a nested tree from flat list', () => {
      const files: WorkspaceFile[] = [
        { id: '1', name: 'folder', kind: 'folder', parentId: null, sortOrder: 0, lastModified: '' },
        { id: '2', name: 'file.md', kind: 'file', parentId: '1', sortOrder: 0, lastModified: '' },
        { id: '3', name: 'root.md', kind: 'file', parentId: null, sortOrder: 1, lastModified: '' },
      ];
      const tree = makeFileTree(files);
      expect(tree).toHaveLength(2);
      expect(tree[0].file.name).toBe('folder');
      expect(tree[0].children).toHaveLength(1);
      expect(tree[0].children[0].file.name).toBe('file.md');
      expect(tree[0].children[0].path).toBe('/folder/file.md');
      expect(tree[1].file.name).toBe('root.md');
    });
  });
});
