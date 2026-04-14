import { describe, it, expect } from 'vitest';

import { ClientAuthStore } from './client-auth-store.js';

describe('ClientAuthStore', () => {
  it('set + get roundtrip', () => {
    const s = new ClientAuthStore();
    s.set('c-1', {
      userId: 7,
      workspaceId: 3,
      displayName: 'U',
      token: 't',
      expiresAt: 9_000_000_000,
    });
    expect(s.get('c-1')?.userId).toBe(7);
  });

  it('isExpired true when past expiresAt', () => {
    const s = new ClientAuthStore();
    s.set('c-1', {
      userId: 1,
      workspaceId: 1,
      displayName: '',
      token: '',
      expiresAt: 1,
    });
    expect(s.isExpired('c-1')).toBe(true);
  });

  it('isExpired true for missing entry', () => {
    const s = new ClientAuthStore();
    expect(s.isExpired('nonexistent')).toBe(true);
  });

  it('delete removes entry', () => {
    const s = new ClientAuthStore();
    s.set('c-1', {
      userId: 1,
      workspaceId: 1,
      displayName: '',
      token: '',
      expiresAt: 9_000_000_000,
    });
    s.delete('c-1');
    expect(s.get('c-1')).toBeUndefined();
  });
});
