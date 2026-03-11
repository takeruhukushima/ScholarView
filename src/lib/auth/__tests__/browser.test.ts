import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initializeAuth, OAUTH_SCOPE } from '../browser';

const { mockClient } = vi.hoisted(() => ({
  mockClient: {
    init: vi.fn().mockResolvedValue(undefined),
    restore: vi.fn(),
    addEventListener: vi.fn(),
  }
}));

// Mock the oauth client
vi.mock('@atproto/oauth-client-browser', () => {
  const MockClient = vi.fn().mockImplementation(() => mockClient) as unknown as (typeof BrowserOAuthClient & { load: ReturnType<typeof vi.fn> });
  // Add static load method
  MockClient.load = vi.fn().mockResolvedValue(mockClient);
  
  return {
    BrowserOAuthClient: MockClient,
    buildLoopbackClientId: vi.fn().mockReturnValue('http://localhost'),
  };
});

describe('auth browser logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockClient.init.mockResolvedValue(undefined);
    mockClient.restore.mockReset();
  });

  it('initializes with no session', async () => {
    const result = await initializeAuth();
    expect(result.did).toBeNull();
    expect(result.handle).toBeNull();
  });

  it('restores session from localStorage', async () => {
    const mockDid = 'did:plc:123';
    localStorage.setItem('scholarview:auth:active-did', mockDid);
    
    mockClient.restore.mockResolvedValue({ 
      did: mockDid, 
      getTokenInfo: () => Promise.resolve({ scope: OAUTH_SCOPE }) 
    });

    const result = await initializeAuth();
    expect(result.did).toBe(mockDid);
    expect(mockClient.restore).toHaveBeenCalledWith(mockDid);
  });

  it('clears session if scopes are insufficient', async () => {
    const mockDid = 'did:plc:insufficient';
    localStorage.setItem('scholarview:auth:active-did', mockDid);
    
    mockClient.restore.mockResolvedValue({ 
      did: mockDid, 
      getTokenInfo: () => Promise.resolve({ scope: 'atproto' }) // Missing other required scopes
    });
    mockClient.revoke = vi.fn().mockResolvedValue(undefined);

    const result = await initializeAuth();
    expect(result.did).toBeNull();
    expect(localStorage.getItem('scholarview:auth:active-did')).toBeNull();
  });
});
