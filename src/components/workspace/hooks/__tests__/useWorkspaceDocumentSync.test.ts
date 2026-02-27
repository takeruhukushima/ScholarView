import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useWorkspaceDocumentSync } from '../useWorkspaceDocumentSync';

describe('useWorkspaceDocumentSync hook', () => {
  const mockSetSavingFile = vi.fn();
  const mockSetFiles = vi.fn();
  const mockSetTitle = vi.fn();
  const mockSetStatusMessage = vi.fn();

  const defaultProps = {
    canEditCurrentFile: true,
    canEditTextCurrentFile: true,
    activeFile: { id: 'f1', name: 'paper.md', kind: 'file' as const, parentId: null, sortOrder: 0, lastModified: '' },
    sourceText: 'Updated content',
    sourceFormat: 'markdown' as const,
    title: 'Paper Title',
    isExistingArticle: false,
    isDirtyFile: true,
    isDirtyTitle: false,
    setSavingFile: mockSetSavingFile,
    setFiles: mockSetFiles,
    setTitle: mockSetTitle,
    setStatusMessage: mockSetStatusMessage,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('triggers autosave after delay when file is dirty', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, file: { ...defaultProps.activeFile, content: 'Updated content' } })
    });

    renderHook(() => useWorkspaceDocumentSync(defaultProps));

    act(() => {
      vi.advanceTimersByTime(800);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/workspace/files/f1'),
      expect.objectContaining({ method: 'PATCH' })
    );
  });

  it('manually saves current file', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, file: { ...defaultProps.activeFile, content: 'Manual update' } })
    });

    const { result } = renderHook(() => useWorkspaceDocumentSync(defaultProps));

    let savedFile;
    await act(async () => {
      savedFile = await result.current.saveCurrentFile();
    });

    expect(mockSetSavingFile).toHaveBeenCalledWith(true);
    expect(mockSetSavingFile).toHaveBeenCalledWith(false);
    expect(savedFile).toBeDefined();
  });
});
