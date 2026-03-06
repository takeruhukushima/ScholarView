import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleClientApiRequest } from '../api';
import type { WorkspaceFileNode } from '@/lib/types';

// Mock all internal dependencies
vi.mock('@/lib/auth/browser', () => ({
  getActiveDid: vi.fn().mockResolvedValue('did:plc:user'),
  getActiveHandle: vi.fn().mockResolvedValue('user.bsky.social'),
  getLexClientForCurrentSession: vi.fn(),
  getSessionFetchHandler: vi.fn(),
}));

vi.mock('@/lib/client/store', () => ({
  getRecentArticles: vi.fn().mockResolvedValue([]),
  upsertAccount: vi.fn().mockResolvedValue(undefined),
  listWorkspaceFiles: vi.fn().mockResolvedValue([]),
  listDrafts: vi.fn().mockResolvedValue([]),
  upsertArticle: vi.fn().mockResolvedValue(undefined),
  moveWorkspaceFile: vi.fn().mockResolvedValue({ success: true }),
  getWorkspaceFileByLinkedArticleUri: vi.fn().mockResolvedValue(null),
  getArticleByDidAndRkey: vi.fn().mockResolvedValue(null),
  createWorkspaceFile: vi.fn(),
  updateWorkspaceFileById: vi.fn().mockResolvedValue(null),
  deleteWorkspaceFileById: vi.fn().mockResolvedValue(undefined),
}));

function makeWorkspaceFile(overrides: Partial<WorkspaceFileNode> = {}): WorkspaceFileNode {
  return {
    ownerDid: 'did:plc:user',
    id: 'f1',
    parentId: null,
    name: 'test.md',
    kind: 'file',
    sourceFormat: 'markdown',
    content: '# Test',
    linkedArticleDid: null,
    linkedArticleRkey: null,
    linkedArticleUri: null,
    sortOrder: 0,
    expanded: 1,
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('client api router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure window.location.origin matches the test request
    Object.defineProperty(window, 'location', {
      value: {
        origin: 'http://localhost',
        hostname: 'localhost'
      },
      writable: true
    });
  });

  it('routes GET /api/articles', async () => {
    const { getRecentArticles } = await import('@/lib/client/store');
    (getRecentArticles as ReturnType<typeof vi.fn>).mockResolvedValue([{ title: 'Test Article' }]);

    const request = new Request('http://localhost/api/articles');
    const response = await handleClientApiRequest(request, undefined, fetch);
    
    expect(response).not.toBeNull();
    expect(response?.status).toBe(200);
    const data = await response?.json();
    expect(data.articles).toHaveLength(1);
    expect(data.articles[0].title).toBe('Test Article');
  });

  it('fails to create article if title is missing', async () => {
    const request = new Request('http://localhost/api/articles', {
      method: 'POST',
      body: JSON.stringify({ title: '', blocks: [] })
    });
    const response = await handleClientApiRequest(request, undefined, fetch);
    expect(response?.status).toBe(400);
    const data = await response?.json();
    expect(data.error).toContain('Title is required');
  });

  it('fails to create article if title is too long', async () => {
    const request = new Request('http://localhost/api/articles', {
      method: 'POST',
      body: JSON.stringify({ title: 'A'.repeat(301), blocks: [] })
    });
    const response = await handleClientApiRequest(request, undefined, fetch);
    expect(response?.status).toBe(400);
    const data = await response?.json();
    expect(data.error).toContain('Title must be <= 300 characters');
  });

  it('routes POST /api/workspace/files/move', async () => {
    const { moveWorkspaceFile } = await import('@/lib/client/store');
    (moveWorkspaceFile as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });

    const request = new Request('http://localhost/api/workspace/files/move', {
      method: 'POST',
      body: JSON.stringify({ draggedId: 'f1', targetId: 'f2', position: 'after' })
    });
    const response = await handleClientApiRequest(request, undefined, fetch);

    expect(response).not.toBeNull();
    expect(response?.status).toBe(200);
    const data = await response?.json();
    expect(data.success).toBe(true);
    expect(moveWorkspaceFile).toHaveBeenCalledWith('f1', 'f2', 'after', 'did:plc:user');
  });

  it('returns 404 for unknown paths', async () => {
    const request = new Request('http://localhost/api/unknown');
    const response = await handleClientApiRequest(request, undefined, fetch);
    expect(response).toBeNull();
  });

  it('dedupes files that share linkedArticleUri during sync', async () => {
    const {
      getRecentArticles,
      listWorkspaceFiles,
      deleteWorkspaceFileById,
      updateWorkspaceFileById,
    } = await import('@/lib/client/store');

    const linkedUri = 'at://did:plc:user/sci.peer.article/main';
    const primary = makeWorkspaceFile({
      id: 'f-primary',
      name: 'test.md',
      linkedArticleUri: linkedUri,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-05T00:00:00.000Z',
    });
    const duplicate = makeWorkspaceFile({
      id: 'f-dup',
      name: 'test-2.md',
      linkedArticleDid: 'did:plc:user',
      linkedArticleRkey: 'main',
      linkedArticleUri: linkedUri,
      createdAt: '2026-03-02T00:00:00.000Z',
      updatedAt: '2026-03-05T00:00:00.000Z',
    });

    (getRecentArticles as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (listWorkspaceFiles as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([primary, duplicate])
      .mockResolvedValueOnce([primary])
      .mockResolvedValueOnce([primary]);

    const request = new Request('http://localhost/api/workspace/sync-articles', {
      method: 'POST',
    });
    const response = await handleClientApiRequest(request, undefined, fetch);
    const data = await response?.json();

    expect(response?.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.created).toBe(0);
    expect(data.deduped).toBe(1);
    expect(deleteWorkspaceFileById).toHaveBeenCalledWith('f-dup', 'did:plc:user');
    expect(updateWorkspaceFileById).toHaveBeenCalledWith('f-primary', 'did:plc:user', {
      linkedArticleDid: 'did:plc:user',
      linkedArticleRkey: 'main',
    });
  });

  it('does not dedupe files with different linkedArticleUri', async () => {
    const {
      getRecentArticles,
      listWorkspaceFiles,
      deleteWorkspaceFileById,
    } = await import('@/lib/client/store');

    const f1 = makeWorkspaceFile({
      id: 'f1',
      name: 'test.md',
      linkedArticleUri: 'at://did:plc:user/sci.peer.article/one',
    });
    const f2 = makeWorkspaceFile({
      id: 'f2',
      name: 'test-2.md',
      linkedArticleUri: 'at://did:plc:user/sci.peer.article/two',
    });

    (getRecentArticles as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (listWorkspaceFiles as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([f1, f2])
      .mockResolvedValueOnce([f1, f2]);

    const request = new Request('http://localhost/api/workspace/sync-articles', {
      method: 'POST',
    });
    const response = await handleClientApiRequest(request, undefined, fetch);
    const data = await response?.json();

    expect(response?.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.deduped).toBe(0);
    expect(deleteWorkspaceFileById).not.toHaveBeenCalled();
  });
});
