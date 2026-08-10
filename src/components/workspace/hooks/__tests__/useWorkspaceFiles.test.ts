import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useWorkspaceFiles } from '../useWorkspaceFiles';

describe('useWorkspaceFiles hook', () => {
  const mockSetBusy = vi.fn();
  const mockSetStatusMessage = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('loads files from API', async () => {
    const mockFiles = [{ id: '1', name: 'test.md', kind: 'file' }];
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, files: mockFiles })
    });

    const { result } = renderHook(() => useWorkspaceFiles());

    await act(async () => {
      await result.current.loadFiles('did:1', mockSetBusy, mockSetStatusMessage);
    });

    expect(result.current.files).toEqual(mockFiles);
  });

  it('creates a new file', async () => {
    const newFile = { id: '2', name: 'new.md', kind: 'file' };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, file: newFile })
    });
    // Second fetch for loadFiles reload
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, files: [newFile] })
    });

    const { result } = renderHook(() => useWorkspaceFiles());

    let created;
    await act(async () => {
      created = await result.current.createWorkspaceItem('new.md', 'file', null, 'did:1', mockSetBusy, mockSetStatusMessage);
    });

    expect(created).toEqual(newFile);
    expect(result.current.files).toContainEqual(newFile);
  });

  it('sends the selected file format to the API', async () => {
    const newFile = { id: '3', name: 'paper.tex', kind: 'file', sourceFormat: 'tex' };
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, file: newFile }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, files: [newFile] }) });

    const { result } = renderHook(() => useWorkspaceFiles());
    await act(async () => {
      await result.current.createWorkspaceItem(
        'paper.tex',
        'file',
        null,
        'did:1',
        mockSetBusy,
        mockSetStatusMessage,
        { format: 'tex', content: '' },
      );
    });

    const request = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(JSON.parse(request.body)).toMatchObject({
      name: 'paper.tex',
      kind: 'file',
      format: 'tex',
    });
  });
});
