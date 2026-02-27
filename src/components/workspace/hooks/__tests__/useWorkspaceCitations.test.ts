import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useWorkspaceCitations } from '../useWorkspaceCitations';

describe('useWorkspaceCitations hook', () => {
  const mockFiles = [
    { id: 'f1', name: 'ref.bib', kind: 'file' as const, content: '@article{key1, title={Title 1}}', parentId: null, sortOrder: 0, lastModified: '' }
  ];
  const mockSetEditorBlocks = vi.fn();
  const mockTextareaRefs = { current: {} };

  const defaultProps = {
    files: mockFiles,
    activeFileId: 'f2',
    articleBibliography: [],
    sourceText: 'Text with [@key1]',
    isImageWorkspaceFile: false,
    setEditorBlocks: mockSetEditorBlocks,
    textareaRefs: mockTextareaRefs as unknown as React.MutableRefObject<Record<string, HTMLTextAreaElement | null>>,
  };

  it('triggers citation menu on @ pattern', () => {
    const { result } = renderHook(() => useWorkspaceCitations(defaultProps));

    act(() => {
      result.current.updateCitationMenu('block1', 'Reference @', 11);
    });

    expect(result.current.citationMenu).not.toBeNull();
    expect(result.current.citationMenu?.query).toBe('');
  });

  it('filters citation entries based on query', () => {
    const { result } = renderHook(() => useWorkspaceCitations(defaultProps));

    act(() => {
      result.current.updateCitationMenu('block1', '@key', 4);
    });

    expect(result.current.filteredCitationEntries).toHaveLength(1);
    expect(result.current.filteredCitationEntries[0].key).toBe('key1');
  });

  it('updates citationMenuIndex', () => {
    const { result } = renderHook(() => useWorkspaceCitations(defaultProps));

    expect(result.current.citationMenuIndex).toBe(0);

    act(() => {
      result.current.setCitationMenuIndex(1);
    });

    expect(result.current.citationMenuIndex).toBe(1);
  });

  it('resolves bibliography from source text', () => {
    const { result } = renderHook(() => useWorkspaceCitations(defaultProps));
    expect(result.current.resolvedBibliography).toHaveLength(1);
    expect(result.current.resolvedBibliography[0].key).toBe('key1');
  });
});
