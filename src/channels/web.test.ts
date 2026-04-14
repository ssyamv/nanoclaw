import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { WebChannel } from './web.js';
import type { ChannelOpts } from './registry.js';
import type { WorkspacePermissionFetcher } from './web-auth.js';

function makeOpts(overrides?: Partial<ChannelOpts>): ChannelOpts {
  return {
    onMessage: vi.fn(),
    onChatMetadata: vi.fn(),
    registeredGroups: () => ({}),
    ...overrides,
  };
}

function b64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signJwt(
  payload: Record<string, unknown>,
  secret: string,
  expSecondsFromNow = 3600,
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = { iat: now, exp: now + expSecondsFromNow, ...payload };
  const h = b64url(Buffer.from(JSON.stringify(header)));
  const p = b64url(Buffer.from(JSON.stringify(body)));
  const sig = b64url(
    crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest(),
  );
  return `${h}.${p}.${sig}`;
}

describe('WebChannel (no auth)', () => {
  let channel: WebChannel;
  let opts: ChannelOpts;

  beforeEach(() => {
    opts = makeOpts();
    channel = new WebChannel(opts, {
      port: 0,
      corsOrigin: '*',
      jwtSecret: null,
      gatewayBaseUrl: null,
    });
  });

  afterEach(async () => {
    if (channel.isConnected()) await channel.disconnect();
  });

  it('has name "web"', () => {
    expect(channel.name).toBe('web');
  });

  it('ownsJid returns true for web: prefix', () => {
    expect(channel.ownsJid('web:client123')).toBe(true);
    expect(channel.ownsJid('feishu:1')).toBe(false);
  });

  it('connect/disconnect lifecycle', async () => {
    expect(channel.isConnected()).toBe(false);
    await channel.connect();
    expect(channel.isConnected()).toBe(true);
    await channel.disconnect();
    expect(channel.isConnected()).toBe(false);
  });

  describe('HTTP endpoints', () => {
    let baseUrl: string;
    beforeEach(async () => {
      await channel.connect();
      baseUrl = `http://127.0.0.1:${channel.getPort()}`;
    });

    it('GET /health returns ok', async () => {
      const res = await fetch(`${baseUrl}/health`);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.status).toBe('ok');
      expect(body.channel).toBe('web');
      expect(body.auth).toBe('disabled');
    });

    it('POST /api/chat calls onMessage and returns 202', async () => {
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: 'user1', message: 'hello' }),
      });
      const body = await res.json();
      expect(res.status).toBe(202);
      expect(body.ok).toBe(true);
      expect(typeof body.message_id).toBe('string');
      expect(opts.onChatMetadata).toHaveBeenCalled();
      expect(opts.onMessage).toHaveBeenCalledWith(
        'web:user1',
        expect.objectContaining({
          chat_jid: 'web:user1',
          content: expect.stringContaining('hello'),
        }),
      );
    });

    it('POST /api/chat returns 400 when fields missing', async () => {
      const r1 = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hi' }),
      });
      expect(r1.status).toBe(400);
      const r2 = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: 'u' }),
      });
      expect(r2.status).toBe(400);
    });

    it('single client_id serialization: second in-flight POST -> 429', async () => {
      const post = (msg: string) =>
        fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: 'userS', message: msg }),
        });
      const r1 = await post('first');
      expect(r1.status).toBe(202);
      const r2 = await post('second');
      expect(r2.status).toBe(429);
      const body = await r2.json();
      expect(body.error).toBe('busy');
    });

    it('sendMessage pushes message_delta + message_end + done + legacy message', async () => {
      const controller = new AbortController();
      const ssePromise = fetch(`${baseUrl}/api/chat/sse?client_id=userSSE`, {
        signal: controller.signal,
      });
      await new Promise((r) => setTimeout(r, 50));

      await channel.sendMessage('web:userSSE', 'Hi there');

      const res = await ssePromise;
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let text = '';
      for (let i = 0; i < 20; i++) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        if (text.includes('event: done')) break;
      }
      controller.abort();
      expect(text).toContain('event: message_delta');
      expect(text).toContain('event: message_end');
      expect(text).toContain('event: done');
      expect(text).toContain('event: message'); // legacy
      expect(text).toContain('Hi there');
    });

    it('Last-Event-ID replays buffered events after reconnect', async () => {
      // Seed events before the SSE client connects.
      await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: 'userR', message: 'seed' }),
      });
      await channel.sendMessage('web:userR', 'response');

      // Connect SSE with Last-Event-ID: 0 — should replay from id 1.
      const controller = new AbortController();
      const res = await fetch(`${baseUrl}/api/chat/sse?client_id=userR`, {
        signal: controller.signal,
        headers: { 'Last-Event-ID': '0' },
      });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let text = '';
      for (let i = 0; i < 10; i++) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        if (text.includes('event: done')) break;
      }
      controller.abort();
      expect(text).toContain('event: session_start');
      expect(text).toContain('event: message_delta');
      expect(text).toContain('event: done');
    });
  });
});

describe('WebChannel (JWT + workspace perm)', () => {
  const SECRET = 'test-secret-123';
  let channel: WebChannel;
  let fetcher: ReturnType<typeof vi.fn>;
  let baseUrl: string;

  beforeEach(async () => {
    fetcher = vi.fn(async (_uid: number, wid: number) =>
      wid === 3 ? { role: 'owner', workspace_slug: 'homture' } : null,
    );
    channel = new WebChannel(makeOpts(), {
      port: 0,
      corsOrigin: '*',
      jwtSecret: SECRET,
      gatewayBaseUrl: null,
      permissionFetcher: fetcher as unknown as WorkspacePermissionFetcher,
      permissionCacheTtlMs: 60_000,
    });
    await channel.connect();
    baseUrl = `http://127.0.0.1:${channel.getPort()}`;
  });

  afterEach(async () => {
    await channel.disconnect();
  });

  it('rejects request without Bearer token', async () => {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: 'u', message: 'hi' }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('missing_bearer_token');
  });

  it('rejects invalid JWT signature', async () => {
    const badToken = signJwt({ user_id: 1 }, 'wrong-secret');
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${badToken}`,
        'X-Workspace-Id': '3',
      },
      body: JSON.stringify({ client_id: 'u', message: 'hi' }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('invalid_token');
  });

  it('rejects expired JWT', async () => {
    const token = signJwt({ user_id: 1 }, SECRET, -10);
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Workspace-Id': '3',
      },
      body: JSON.stringify({ client_id: 'u', message: 'hi' }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('token_expired');
  });

  it('rejects missing X-Workspace-Id', async () => {
    const token = signJwt({ user_id: 1 }, SECRET);
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ client_id: 'u', message: 'hi' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('missing_x_workspace_id');
  });

  it('rejects unauthorized workspace', async () => {
    const token = signJwt({ user_id: 1 }, SECRET);
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Workspace-Id': '999',
      },
      body: JSON.stringify({ client_id: 'u', message: 'hi' }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('workspace_forbidden');
  });

  it('accepts valid JWT + workspace and exposes buildSystemContext', async () => {
    const token = signJwt({ user_id: 42, username: 'chenqi' }, SECRET);
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Workspace-Id': '3',
      },
      body: JSON.stringify({ client_id: 'web-42-abc', message: 'hi' }),
    });
    expect(res.status).toBe(202);
    const ctx = channel.buildSystemContext('web:web-42-abc');
    expect(ctx).toContain('[CURRENT CONTEXT]');
    expect(ctx).toContain('user_id: 42');
    expect(ctx).toContain('workspace_id: 3');
    expect(ctx).toContain('slug=homture');
    expect(ctx).toContain('workspace_role: owner');
  });

  it('permission cache: repeat requests within TTL hit fetcher once', async () => {
    const token = signJwt({ user_id: 7 }, SECRET);
    for (let i = 0; i < 3; i++) {
      await fetch(`${baseUrl}/api/chat/sse?client_id=u${i}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Workspace-Id': '3',
        },
      }).then((r) => r.body?.cancel());
    }
    // POST triggers auth path too; only first should hit gateway.
    await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Workspace-Id': '3',
      },
      body: JSON.stringify({ client_id: 'uX', message: 'hi' }),
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
