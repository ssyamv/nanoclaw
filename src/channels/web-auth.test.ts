import { describe, it, expect, vi } from 'vitest';
import crypto from 'crypto';
import {
  JwtError,
  WorkspacePermissionCache,
  formatSystemContext,
  verifyJwt,
} from './web-auth.js';

function b64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}
function sign(payload: Record<string, unknown>, secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const h = b64url(Buffer.from(JSON.stringify(header)));
  const p = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(
    crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest(),
  );
  return `${h}.${p}.${sig}`;
}

describe('verifyJwt', () => {
  const S = 'secret';

  it('accepts a valid HS256 token', () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const tok = sign({ user_id: 1, exp }, S);
    const p = verifyJwt(tok, S);
    expect(p.user_id).toBe(1);
  });

  it('rejects malformed tokens', () => {
    expect(() => verifyJwt('abc', S)).toThrow(JwtError);
    expect(() => verifyJwt('', S)).toThrow(JwtError);
  });

  it('rejects wrong secret', () => {
    const tok = sign({ user_id: 1 }, S);
    try {
      verifyJwt(tok, 'other');
      throw new Error('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(JwtError);
      expect((e as JwtError).code).toBe('invalid');
    }
  });

  it('rejects expired tokens', () => {
    const tok = sign(
      { user_id: 1, exp: Math.floor(Date.now() / 1000) - 10 },
      S,
    );
    try {
      verifyJwt(tok, S);
      throw new Error('should throw');
    } catch (e) {
      expect((e as JwtError).code).toBe('expired');
    }
  });

  it('rejects non-HS256 alg', () => {
    const header = b64url(
      Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })),
    );
    const payload = b64url(Buffer.from(JSON.stringify({ user_id: 1 })));
    try {
      verifyJwt(`${header}.${payload}.`, S);
      throw new Error('should throw');
    } catch (e) {
      expect((e as JwtError).code).toBe('invalid');
    }
  });

  it('rejects missing user_id', () => {
    const tok = sign({ foo: 'bar' }, S);
    try {
      verifyJwt(tok, S);
      throw new Error('should throw');
    } catch (e) {
      expect((e as JwtError).code).toBe('invalid');
    }
  });
});

describe('WorkspacePermissionCache', () => {
  it('caches within TTL', async () => {
    const fetcher = vi.fn(async () => ({ role: 'member' }));
    const cache = new WorkspacePermissionCache(fetcher, 1000);
    await cache.check(1, 2, 't');
    await cache.check(1, 2, 't');
    await cache.check(1, 2, 't');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('refetches after TTL', async () => {
    const fetcher = vi.fn(async () => ({ role: 'member' }));
    const cache = new WorkspacePermissionCache(fetcher, 5);
    await cache.check(1, 2, 't');
    await new Promise((r) => setTimeout(r, 10));
    await cache.check(1, 2, 't');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('caches denies too', async () => {
    const fetcher = vi.fn(async () => null);
    const cache = new WorkspacePermissionCache(fetcher, 1000);
    expect(await cache.check(1, 2, 't')).toBeNull();
    expect(await cache.check(1, 2, 't')).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('isolates by (user,workspace) pair', async () => {
    const fetcher = vi.fn(async () => ({ role: 'member' }));
    const cache = new WorkspacePermissionCache(fetcher, 1000);
    await cache.check(1, 2, 't');
    await cache.check(1, 3, 't');
    await cache.check(2, 2, 't');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});

describe('formatSystemContext', () => {
  it('renders all fields', () => {
    const s = formatSystemContext(
      {
        user_id: 12,
        username: 'chenqi',
        workspace_id: 3,
        workspace_slug: 'homture',
        role: 'owner',
      },
      '2026-04-14T00:00:00Z',
    );
    expect(s).toContain('user_id: 12');
    expect(s).toContain('username: chenqi');
    expect(s).toContain('workspace_id: 3 (slug=homture)');
    expect(s).toContain('workspace_role: owner');
    expect(s).toContain('timestamp: 2026-04-14T00:00:00Z');
  });
});
