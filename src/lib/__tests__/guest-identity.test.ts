import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getOrCreateGuestIdentity, signAsGuest, clearGuestIdentity, GUEST_DID_PREFIX } from '../guest-identity';

// Mocking localStorage for tests
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value.toString(); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; }
  };
})();

vi.stubGlobal('localStorage', localStorageMock);
vi.stubGlobal('window', { location: { host: 'localhost:3000' } });

describe('guest-identity', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  describe('getOrCreateGuestIdentity', () => {
    it('creates a new identity when none exists', async () => {
      const identity = await getOrCreateGuestIdentity();
      
      expect(identity.did).toContain(GUEST_DID_PREFIX);
      expect(identity.publicKeyMultibase).toMatch(/^z/);
      expect(localStorageMock.getItem('scholarview:guest:key')).toBeDefined();
    });

    it('retrieves an existing identity from localStorage', async () => {
      const first = await getOrCreateGuestIdentity();
      const second = await getOrCreateGuestIdentity();
      
      expect(first.did).toBe(second.did);
      expect(first.publicKeyMultibase).toBe(second.publicKeyMultibase);
    });

    it('creates a different identity if cleared', async () => {
      const first = await getOrCreateGuestIdentity();
      clearGuestIdentity();
      const second = await getOrCreateGuestIdentity();
      
      expect(first.did).not.toBe(second.did);
    });
  });

  describe('signAsGuest', () => {
    it('signs data using the keypair', async () => {
      const identity = await getOrCreateGuestIdentity();
      const message = 'Hello, DeSci!';
      const signature = await signAsGuest(identity.keypair, message);
      
      expect(signature).toBeInstanceOf(Uint8Array);
      expect(signature.length).toBeGreaterThan(0);
    });
  });
});
