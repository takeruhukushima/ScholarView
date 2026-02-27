import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleClientApiRequest } from '../api';

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
}));

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

  it('returns 404 for unknown paths', async () => {
    const request = new Request('http://localhost/api/unknown');
    const response = await handleClientApiRequest(request, undefined, fetch);
    expect(response).toBeNull();
  });
});
