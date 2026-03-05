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
    projectBibEntries: [],
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
    files: [],
    triggerAuthModal: vi.fn(),
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

    await act(async () => {
      await result.current.handlePublish();
    });

    expect(result.current.broadcastPreviewText).not.toBeNull();

    try {
      await act(async () => {
        await result.current.confirmPublish('Custom Text');
      });
    } catch {
      // Expected error
    }

    expect(mockSetBusy).toHaveBeenCalledWith(true);
    expect(mockSetStatusMessage).toHaveBeenCalledWith(expect.stringContaining('Server Crash'));
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

  it('requires sessionDid to publish', async () => {
    const mockTriggerAuthModal = vi.fn();
    const unauthProps = { ...defaultProps, sessionDid: null, triggerAuthModal: mockTriggerAuthModal };
    const { result } = renderHook(() => useWorkspacePublishing(unauthProps));

    await act(async () => {
      await result.current.handlePublish();
    });

    expect(mockTriggerAuthModal).toHaveBeenCalledWith(
      "Broadcast Identity",
      expect.any(String)
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('separates sync state from update notification flag', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        did: 'did:plc:user',
        rkey: 'rkey1',
        uri: 'at://did:plc:user/sci.peer.article/rkey1',
        broadcasted: 1,
      }),
    });

    const updateProps = {
      ...defaultProps,
      currentDid: 'did:plc:user',
      currentRkey: 'rkey1',
      broadcastToBsky: true,
    };
    const { result } = renderHook(() => useWorkspacePublishing(updateProps));

    await act(async () => {
      await result.current.handlePublish();
    });

    await act(async () => {
      await result.current.confirmPublish('Update text', false);
    });

    expect(global.fetch).toHaveBeenCalled();
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.broadcastToBsky).toBe(true);
    expect(body.notifyUpdate).toBe(false);
  });
});
