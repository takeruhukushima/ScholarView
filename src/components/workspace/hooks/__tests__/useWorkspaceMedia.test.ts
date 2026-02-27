import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useWorkspaceMedia } from '../useWorkspaceMedia';

describe('useWorkspaceMedia hook', () => {
  const mockSetFiles = vi.fn();
  const mockSetEditorBlocks = vi.fn();
  const mockSetActiveBlockId = vi.fn();

  const defaultProps = {
    files: [{ id: 'img1', name: 'cat.png', kind: 'file' as const, content: 'data:image/png;base64,123', parentId: null, sortOrder: 0, lastModified: '' }],
    setFiles: mockSetFiles,
    activeFile: null,
    activeFilePath: '/paper.md',
    workspaceFilesByPath: new Map(),
    editorBlocks: [],
    setEditorBlocks: mockSetEditorBlocks,
    activeBlockId: null,
    setActiveBlockId: mockSetActiveBlockId,
    canEditTextCurrentFile: true,
    isBibWorkspaceFile: false,
    sessionDid: 'did:plc:user',
    setBusy: vi.fn(),
    setStatusMessage: vi.fn(),
    loadFiles: vi.fn(),
    filePathMap: new Map(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('resolves workspace:// image source', () => {
    const { result } = renderHook(() => useWorkspaceMedia(defaultProps));
    const resolved = result.current.resolveWorkspaceImageSrc('workspace://img1');
    expect(resolved).toBe('data:image/png;base64,123');
  });

  it('handles non-existent workspace images', () => {
    const { result } = renderHook(() => useWorkspaceMedia(defaultProps));
    const resolved = result.current.resolveWorkspaceImageSrc('workspace://missing');
    expect(resolved).toBe('workspace://missing');
  });
});
