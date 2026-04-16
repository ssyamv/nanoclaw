import { describe, it, expect, afterEach, vi } from 'vitest';

import { verifyViaGateway } from './gateway-verify.js';

const origFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = origFetch;
  vi.restoreAllMocks();
});

describe('verifyViaGateway', () => {
  it('returns data on 200', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            code: 0,
            data: {
              userId: 7,
              workspaceId: 3,
              displayName: 'U',
              expiresAt: 9_000_000_000,
            },
          }),
          { status: 200 },
        ),
    ) as typeof fetch;
    const r = await verifyViaGateway('http://g', 't');
    expect(r.userId).toBe(7);
    expect(r.workspaceId).toBe(3);
  });

  it('throws AUTH_EXPIRED on 401 with code AUTH_EXPIRED', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: 'AUTH_EXPIRED' }), { status: 401 }),
    ) as typeof fetch;
    await expect(verifyViaGateway('http://g', 't')).rejects.toThrow(
      'AUTH_EXPIRED',
    );
  });

  it('throws AUTH_INVALID on other 401', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: 'AUTH_INVALID' }), { status: 401 }),
    ) as typeof fetch;
    await expect(verifyViaGateway('http://g', 't')).rejects.toThrow(
      'AUTH_INVALID',
    );
  });

  it('throws GATEWAY_UNREACHABLE on network error', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    await expect(verifyViaGateway('http://g', 't')).rejects.toThrow(
      'GATEWAY_UNREACHABLE',
    );
  });
});
