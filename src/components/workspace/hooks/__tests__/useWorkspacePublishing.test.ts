import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useWorkspacePublishing } from '../useWorkspacePublishing';

describe('useWorkspacePublishing hook - Hardened', () => {
  const mockSetBusy = vi.fn();
  const mockSetStatusMessage = vi.fn();
  const mockSaveCurrentFile = vi.fn().mockResolvedValue({});
  const mockRefreshArticles = vi.fn();

  const defaultProps = {
    sessionDid: 'did:plc:user',
    activeFile: { id: 'f1', name: 'paper.md', kind: 'file' as const, parentId: null, sortOrder: 0, lastModified: '' },
    title: 'New Paper',
    authorsText: 'Alice',
    broadcastToBsky: true,
    resolvedBibliography: [],
    sourceText: '# Hello',
    sourceFormat: 'markdown' as const,
    currentDid: null,
    currentRkey: null,
    missingCitationKeys: [],
    tab: 'preview',
    setBusy: mockSetBusy,
    setStatusMessage: mockSetStatusMessage,
    setBroadcastToBsky: vi.fn(),
    setFiles: vi.fn(),
    setCurrentDid: vi.fn(),
    setCurrentRkey: vi.fn(),
    setActiveArticleUri: vi.fn(),
    setCurrentAuthorDid: vi.fn(),
    saveCurrentFile: mockSaveCurrentFile,
    refreshArticles: mockRefreshArticles,
    loadDiscussion: vi.fn(),
    normalizeWorkspaceImageUrisForExport: (s: string) => s,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('recovers state (sets busy false) even when publishing fails', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Server Crash' })
    });

    const { result } = renderHook(() => useWorkspacePublishing(defaultProps));

    try {
      await act(async () => {
        await result.current.handlePublish();
      });
    } catch (_e) {
      // Expected error
    }

    expect(mockSetBusy).toHaveBeenCalledWith(true);
    expect(mockSetBusy).toHaveBeenCalledWith(false); 
  });

  it('prevents publishing specialized files (bib/image)', async () => {
    const bibFileProps = { 
      ...defaultProps, 
      activeFile: { ...defaultProps.activeFile, name: 'refs.bib' } 
    };
    const { result } = renderHook(() => useWorkspacePublishing(bibFileProps));

    await act(async () => {
      await result.current.handlePublish();
    });

    expect(mockSetStatusMessage).toHaveBeenCalledWith(expect.stringContaining('BibTeX files'));
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
