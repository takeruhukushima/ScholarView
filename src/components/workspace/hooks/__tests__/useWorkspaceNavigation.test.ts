import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useWorkspaceNavigation } from '../useWorkspaceNavigation';

describe('useWorkspaceNavigation hook - Hardened', () => {
  const mockSetEditorBlocks = vi.fn();
  const mockSetTitle = vi.fn();
  const mockSetCitationMenu = vi.fn();
  const mockSetSelectedQuote = vi.fn();

  const defaultProps = {
    files: [],
    sessionDid: 'did:plc:user',
    articleByUri: new Map(),
    loadFiles: vi.fn(),
    syncLegacyArticles: vi.fn(),
    setActiveFileId: vi.fn(),
    setActiveArticleUri: vi.fn(),
    setSourceFormat: vi.fn(),
    setEditorBlocks: mockSetEditorBlocks,
    setCurrentDid: vi.fn(),
    setCurrentRkey: vi.fn(),
    setCurrentAuthorDid: vi.fn(),
    setTitle: mockSetTitle,
    setAuthorsText: vi.fn(),
    setBroadcastToBsky: vi.fn(),
    setArticleBibliography: vi.fn(),
    setSelectedQuote: mockSetSelectedQuote,
    setQuoteComment: vi.fn(),
    setShowMoreMenu: vi.fn(),
    setActiveBlockId: vi.fn(),
    setBlockMenuForId: vi.fn(),
    setCitationMenu: mockSetCitationMenu,
    setStatusMessage: vi.fn(),
    setBusy: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('resets ephemeral UI state (menu, quote) when opening a new file', async () => {
    const mockFile = { id: 'f1', name: 'new.md', kind: 'file' as const, parentId: null, sortOrder: 0, lastModified: '' };
    const { result } = renderHook(() => useWorkspaceNavigation(defaultProps));

    await act(async () => {
      await result.current.openFile(mockFile);
    });

    // Epic verification: switching files must clear previous "mess"
    expect(mockSetCitationMenu).toHaveBeenCalledWith(null);
    expect(mockSetSelectedQuote).toHaveBeenCalledWith("");
  });

  it('correctly detects .bib files and loads bib-specific editor blocks', async () => {
    const mockBibFile = { id: 'b1', name: 'refs.bib', kind: 'file' as const, content: '@article{k1, title={T}}', parentId: null, sortOrder: 0, lastModified: '' };
    const { result } = renderHook(() => useWorkspaceNavigation(defaultProps));

    await act(async () => {
      await result.current.openFile(mockBibFile);
    });

    // Should call setEditorBlocks with something (bib-parsed blocks)
    expect(mockSetEditorBlocks).toHaveBeenCalled();
    const blocks = mockSetEditorBlocks.mock.calls[0][0];
    expect(blocks[0].text).toContain('@article');
  });
});
