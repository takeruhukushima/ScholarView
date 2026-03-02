import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleClientApiRequest } from '../api';
import * as store from '@/lib/client/store';
import * as auth from '@/lib/auth/browser';

import { Mock } from 'vitest';

vi.mock('@/lib/auth/browser', () => ({
  getActiveDid: vi.fn(),
  getActiveHandle: vi.fn(),
  getLexClientForCurrentSession: vi.fn(),
  getSessionFetchHandler: vi.fn(),
}));

vi.mock('@/lib/client/store', () => ({
  getArticleByDidAndRkey: vi.fn(),
  getAnnouncementByArticleUri: vi.fn(),
  getInlineCommentsByArticle: vi.fn().mockResolvedValue([]),
  upsertArticleAnnouncement: vi.fn(),
  listBskyInteractionsBySubjects: vi.fn().mockResolvedValue([]),
  upsertAccount: vi.fn(),
}));

describe('Announcement Discovery', () => {
  const mockDid = 'did:plc:author';
  const mockRkey = 'article123';
  const mockArticleUri = `at://${mockDid}/sci.peer.article/${mockRkey}`;
  const mockAnnouncementUri = `at://${mockDid}/app.bsky.feed.post/post456`;
  const mockAnnouncementCid = 'bafyreih...';
  
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'location', {
      value: {
        origin: 'http://localhost',
        hostname: 'localhost'
      },
      writable: true
    });
  });

  it('discovers announcement if missing from local store when fetching discussion', async () => {
    // 1. Guest user (no active session)
    (auth.getActiveDid as Mock).mockResolvedValue(null);
    
    // 2. Article exists but no announcement in local store
    (store.getAnnouncementByArticleUri as Mock).mockResolvedValue(null);
    
    // 3. Mock the author's feed fetch
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('app.bsky.feed.getAuthorFeed')) {
        return Promise.resolve(new Response(JSON.stringify({
          feed: [
            {
              post: {
                uri: mockAnnouncementUri,
                cid: mockAnnouncementCid,
                record: {
                  embed: {
                    $type: 'app.bsky.embed.external',
                    external: {
                      uri: `http://localhost/article/${mockDid}/${mockRkey}`
                    }
                  }
                }
              }
            }
          ]
        })));
      }
      if (url.includes('app.bsky.feed.getPostThread')) {
        return Promise.resolve(new Response(JSON.stringify({
          thread: {
            post: {
              uri: mockAnnouncementUri,
              cid: mockAnnouncementCid,
              record: { text: 'Announcement post' },
              author: { handle: 'author.bsky.social', did: mockDid }
            },
            replies: []
          }
        })));
      }
      return Promise.reject(new Error(`Unexpected fetch to ${url}`));
    });

    const request = new Request(`http://localhost/api/articles/${mockDid}/${mockRkey}/discussion`);
    const response = await handleClientApiRequest(request, undefined, mockFetch);
    
    expect(response?.status).toBe(200);
    const data = await response?.json();
    
    // Should have discovered the root post
    expect(data.root.uri).toBe(mockAnnouncementUri);
    
    // Should have persisted it
    expect(store.upsertArticleAnnouncement).toHaveBeenCalledWith(expect.objectContaining({
      articleUri: mockArticleUri,
      announcementUri: mockAnnouncementUri
    }));
  });

  it('populates announcementUri in article detail if missing', async () => {
    (auth.getActiveDid as Mock).mockResolvedValue(null);
    
    // Mock getArticleByDidAndRkey to return article WITHOUT announcement
    (store.getArticleByDidAndRkey as Mock).mockResolvedValue({
      uri: mockArticleUri,
      did: mockDid,
      rkey: mockRkey,
      authorDid: mockDid,
      title: 'Test Article',
      announcementUri: null,
      blocks: [],
      bibliography: []
    });

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('app.bsky.feed.getAuthorFeed')) {
        return Promise.resolve(new Response(JSON.stringify({
          feed: [
            {
              post: {
                uri: mockAnnouncementUri,
                cid: mockAnnouncementCid,
                record: {
                  embed: {
                    $type: 'app.bsky.embed.external',
                    external: {
                      uri: `http://localhost/article/${mockDid}/${mockRkey}`
                    }
                  }
                }
              }
            }
          ]
        })));
      }
      return Promise.reject(new Error('Unexpected fetch'));
    });

    const request = new Request(`http://localhost/api/articles/${mockDid}/${mockRkey}`);
    const response = await handleClientApiRequest(request, undefined, mockFetch);
    
    expect(response?.status).toBe(200);
    const data = await response?.json();
    
    expect(data.article.announcementUri).toBe(mockAnnouncementUri);
    expect(store.upsertArticleAnnouncement).toHaveBeenCalled();
  });
});
