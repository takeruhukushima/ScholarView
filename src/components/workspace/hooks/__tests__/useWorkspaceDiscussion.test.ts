import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useWorkspaceDiscussion } from '../useWorkspaceDiscussion';

describe('useWorkspaceDiscussion hook - Hardened', () => {
  const defaultProps = {
    sessionDid: 'did:plc:user',
    currentDid: 'did:plc:author',
    currentRkey: 'abc-123',
    setBusy: vi.fn(),
    setStatusMessage: vi.fn(),
    setTab: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('correctly flattens deeply nested discussion threads', async () => {
    const mockData = {
      success: true,
      root: { uri: 'at://root', cid: 'c1', text: 'Root' },
      thread: [
        { uri: 'at://p1', text: 'Parent', authorDid: 'd1', depth: 1 },
        { uri: 'at://p2', text: 'Child', authorDid: 'd2', parentUri: 'at://p1', depth: 2 },
        { uri: 'at://p3', text: 'Grandchild', authorDid: 'd3', parentUri: 'at://p2', depth: 3 }
      ]
    };

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockData
    });

    const { result } = renderHook(() => useWorkspaceDiscussion(defaultProps));

    await act(async () => {
      await result.current.loadDiscussion();
    });

    expect(result.current.discussionPosts).toHaveLength(3);
    expect(result.current.discussionPosts[2].parentUri).toBe('at://p2');
    expect(result.current.discussionPosts[2].depth).toBe(3);
  });

  it('handles API errors gracefully during load', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ success: false })
    });

    const { result } = renderHook(() => useWorkspaceDiscussion(defaultProps));

    await expect(act(async () => {
      await result.current.loadDiscussion();
    })).rejects.toThrow('Failed to load discussion');
  });
});
