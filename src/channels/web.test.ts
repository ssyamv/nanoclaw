import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebChannel } from './web.js';
import type { ChannelOpts } from './registry.js';
import { ClientAuthStore } from '../auth/client-auth-store.js';
import type { VerifiedContext } from '../auth/gateway-verify.js';

function makeOpts(overrides?: Partial<ChannelOpts>): ChannelOpts {
  return {
    onMessage: vi.fn(),
    onChatMetadata: vi.fn(),
    registeredGroups: () => ({}),
    ...overrides,
  };
}

const okVerifiedCtx: VerifiedContext = {
  userId: 7,
  workspaceId: 3,
  displayName: 'U',
  expiresAt: 9e9,
};

function makeVerify(
  behavior: 'ok' | 'expired' | 'invalid' = 'ok',
): (token: string) => Promise<VerifiedContext> {
  return async (token: string) => {
    if (behavior === 'ok' && token === 't.ok') return okVerifiedCtx;
    if (behavior === 'expired' || token === 't.exp')
      throw new Error('AUTH_EXPIRED');
    throw new Error('AUTH_INVALID');
  };
}

describe('WebChannel', () => {
  let channel: WebChannel;
  let opts: ChannelOpts;
  let store: ClientAuthStore;

  beforeEach(() => {
    opts = makeOpts();
    store = new ClientAuthStore();
    // Use port 0 to get a random available port
    channel = new WebChannel(opts, 0, '*', store, makeVerify('ok'));
  });

  afterEach(async () => {
    if (channel.isConnected()) {
      await channel.disconnect();
    }
  });

  it('has name "web"', () => {
    expect(channel.name).toBe('web');
  });

  it('ownsJid returns true for web: prefix', () => {
    expect(channel.ownsJid('web:client123')).toBe(true);
    expect(channel.ownsJid('web:abc')).toBe(true);
  });

  it('ownsJid returns false for other prefixes', () => {
    expect(channel.ownsJid('feishu:123')).toBe(false);
    expect(channel.ownsJid('telegram:456')).toBe(false);
    expect(channel.ownsJid('client123')).toBe(false);
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
      const port = channel.getPort();
      baseUrl = `http://127.0.0.1:${port}`;
    });

    it('GET /health returns ok', async () => {
      const res = await fetch(`${baseUrl}/health`);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.status).toBe('ok');
      expect(body.channel).toBe('web');
      expect(typeof body.clients).toBe('number');
    });

    it('POST /api/chat calls onMessage and onChatMetadata', async () => {
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer t.ok',
        },
        body: JSON.stringify({ client_id: 'user1', message: 'hello' }),
      });
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(typeof body.message_id).toBe('string');

      expect(opts.onChatMetadata).toHaveBeenCalledWith(
        'web:user1',
        expect.any(String),
        'Web-user1',
        'web',
        false,
      );

      expect(opts.onMessage).toHaveBeenCalledWith(
        'web:user1',
        expect.objectContaining({
          chat_jid: 'web:user1',
          sender: 'user1',
          sender_name: 'user1',
          content: expect.stringContaining('hello'),
        }),
      );
    });

    it('POST /api/chat returns 400 if client_id missing', async () => {
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer t.ok',
        },
        body: JSON.stringify({ message: 'hello' }),
      });
      expect(res.status).toBe(400);
    });

    it('POST /api/chat returns 400 if message missing', async () => {
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer t.ok',
        },
        body: JSON.stringify({ client_id: 'user1' }),
      });
      expect(res.status).toBe(400);
    });

    it('sendMessage pushes to SSE client', async () => {
      // Connect SSE client
      const controller = new AbortController();
      const ssePromise = fetch(
        `${baseUrl}/api/chat/sse?client_id=user2&token=t.ok`,
        {
          signal: controller.signal,
        },
      );

      // Wait a moment for SSE connection to establish
      await new Promise((r) => setTimeout(r, 100));

      // Send a message via the channel
      await channel.sendMessage('web:user2', 'Hello from bot');

      // Read SSE response
      const res = await ssePromise;
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');

      // Read the body incrementally
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let text = '';

      // Read chunks until we get the message event
      const readUntilMessage = async () => {
        for (let i = 0; i < 10; i++) {
          const { value, done } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
          if (text.includes('"content":')) return;
        }
      };
      await readUntilMessage();

      controller.abort();

      expect(text).toContain('event: message');
      expect(text).toContain('Hello from bot');
    });

    // --- Task 4: POST auth ---------------------------------------------------

    it('POST /api/chat without Authorization returns 401 AUTH_INVALID', async () => {
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: 'c-1', message: 'hi' }),
      });
      expect(res.status).toBe(401);
      expect((await res.json()).code).toBe('AUTH_INVALID');
    });

    it('POST /api/chat with valid bearer populates store + invokes onMessage', async () => {
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer t.ok',
        },
        body: JSON.stringify({ client_id: 'c-2', message: 'hi' }),
      });
      expect(res.status).toBe(200);
      expect(opts.onMessage).toHaveBeenCalled();
      expect(store.get('c-2')?.userId).toBe(7);
    });

    it('POST /api/chat with expired bearer returns 401 AUTH_EXPIRED', async () => {
      const expChannel = new WebChannel(
        opts,
        0,
        '*',
        store,
        makeVerify('expired'),
      );
      await expChannel.connect();
      const expPort = expChannel.getPort();
      try {
        const res = await fetch(`http://127.0.0.1:${expPort}/api/chat`, {
          method: 'POST',
          headers: {
            authorization: 'Bearer t.exp',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ client_id: 'c-3', message: 'hi' }),
        });
        expect(res.status).toBe(401);
        expect((await res.json()).code).toBe('AUTH_EXPIRED');
      } finally {
        await expChannel.disconnect();
      }
    });

    // --- Task 5: SSE auth ----------------------------------------------------

    it('GET /api/chat/sse without token returns 401', async () => {
      const res = await fetch(`${baseUrl}/api/chat/sse?client_id=c-1`);
      expect(res.status).toBe(401);
    });

    it('GET /api/chat/sse with valid token establishes SSE', async () => {
      store.set('c-2', {
        userId: 7,
        workspaceId: 3,
        displayName: 'U',
        token: 't.ok',
        expiresAt: 9e9,
      });
      const controller = new AbortController();
      const res = await fetch(
        `${baseUrl}/api/chat/sse?client_id=c-2&token=t.ok`,
        {
          signal: controller.signal,
        },
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      controller.abort();
    });

    it('GET /api/chat/sse with mismatched token returns 401', async () => {
      store.set('c-3', {
        userId: 7,
        workspaceId: 3,
        displayName: 'U',
        token: 't.ok',
        expiresAt: 9e9,
      });
      const res = await fetch(
        `${baseUrl}/api/chat/sse?client_id=c-3&token=evil`,
      );
      expect(res.status).toBe(401);
    });
  });
});
