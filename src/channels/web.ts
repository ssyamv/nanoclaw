import express, { Request, Response } from 'express';
import http from 'http';

import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import { ASSISTANT_NAME } from '../config.js';
import { registerChannel, ChannelOpts } from './registry.js';
import { Channel } from '../types.js';
import { ClientAuthStore, setAuthForJid } from '../auth/client-auth-store.js';
import {
  verifyViaGateway,
  type VerifiedContext,
} from '../auth/gateway-verify.js';

export class WebChannel implements Channel {
  name = 'web';

  private opts: ChannelOpts;
  private port: number;
  private corsOrigin: string;
  private store: ClientAuthStore;
  private verify: (token: string) => Promise<VerifiedContext>;
  private connected = false;
  private httpServer: http.Server | null = null;
  private sseClients = new Map<string, Response>();
  private jidToClientId = new Map<string, string>();
  private sseHistory = new Map<
    string,
    Array<{ id: number; event: string; data: unknown }>
  >();
  private nextEventId = 1;

  constructor(
    opts: ChannelOpts,
    port: number,
    corsOrigin: string,
    store?: ClientAuthStore,
    verify?: (token: string) => Promise<VerifiedContext>,
  ) {
    this.opts = opts;
    this.port = port;
    this.corsOrigin = corsOrigin;
    this.store = store ?? new ClientAuthStore();
    const gatewayUrl =
      process.env.ARCFLOW_GATEWAY_URL ?? 'http://localhost:3001';
    this.verify =
      verify ?? ((token: string) => verifyViaGateway(gatewayUrl, token));
  }

  private canonicalJid(
    clientId: string,
    ctx?: VerifiedContext,
  ): string {
    if (ctx?.userId) return `web:user-${ctx.userId}`;
    return `web:${clientId}`;
  }

  async connect(): Promise<void> {
    const app = express();
    app.use(express.json());

    // CORS middleware
    app.use((_req: Request, res: Response, next) => {
      res.setHeader('Access-Control-Allow-Origin', this.corsOrigin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (_req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
      next();
    });

    // POST /api/chat — receive messages from web clients
    app.post('/api/chat', async (req: Request, res: Response) => {
      const { client_id, message } = req.body || {};
      if (!client_id || !message) {
        res
          .status(400)
          .json({ ok: false, error: 'client_id and message are required' });
        return;
      }

      // --- Auth ---
      // System dispatch bypass: if X-System-Secret matches the configured
      // NANOCLAW_DISPATCH_SECRET, skip Bearer check and use a synthetic
      // system context. Gateway encodes workspace_id in the [SYSTEM DISPATCH]
      // message body; extract it for ctx.workspaceId.
      const systemSecret = req.headers['x-system-secret'];
      const expectedSecret = process.env.NANOCLAW_DISPATCH_SECRET;
      const isSystemDispatch =
        typeof systemSecret === 'string' &&
        !!expectedSecret &&
        systemSecret === expectedSecret;

      let ctx: VerifiedContext & { token: string };
      if (isSystemDispatch) {
        const wsMatch = /workspace_id=(\d+)/.exec(String(message));
        const workspaceId = wsMatch ? Number(wsMatch[1]) : 0;
        ctx = {
          userId: 0,
          workspaceId,
          displayName: 'system',
          expiresAt: Number.MAX_SAFE_INTEGER,
          token: 'system',
        };
      } else {
        const header = req.headers['authorization'];
        if (!header || !header.startsWith('Bearer ')) {
          res.status(401).json({ ok: false, code: 'AUTH_INVALID' });
          return;
        }
        const token = header.slice(7);

        // Verify token (use cached entry if token matches and not expired)
        const cached = this.store.get(client_id);
        if (
          cached &&
          cached.token === token &&
          !this.store.isExpired(client_id)
        ) {
          ctx = cached;
        } else {
          try {
            const v = await this.verify(token);
            ctx = { ...v, token };
            this.store.set(client_id, ctx);
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : '';
            const code =
              msg === 'AUTH_EXPIRED' ? 'AUTH_EXPIRED' : 'AUTH_INVALID';
            res.status(401).json({ ok: false, code });
            return;
          }
        }
      }
      const chatJid = this.canonicalJid(client_id, ctx);
      setAuthForJid(chatJid, ctx);
      setAuthForJid(`web:${client_id}`, ctx);
      this.jidToClientId.set(chatJid, client_id);
      // --- End Auth ---

      const timestamp = new Date().toISOString();
      const messageId = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const content = `@${ASSISTANT_NAME} ${message}`.trim();

      this.opts.onChatMetadata(
        chatJid,
        timestamp,
        `Web-${chatJid.slice(4)}`,
        'web',
        false,
      );

      this.opts.onMessage(chatJid, {
        id: messageId,
        chat_jid: chatJid,
        sender: client_id,
        sender_name: client_id,
        content,
        timestamp,
      });

      this.emitEvent(client_id, 'session_start', {
        client_id,
        message_id: messageId,
      });

      res.json({ ok: true, message_id: messageId });
    });

    // GET /api/chat/sse — SSE connection for receiving bot responses
    app.get('/api/chat/sse', async (req: Request, res: Response) => {
      const clientId = req.query.client_id as string;
      const token = req.query.token as string;

      if (!clientId || !token) {
        res.status(401).json({ ok: false, code: 'AUTH_INVALID' });
        return;
      }

      // Verify token (use cached entry if token matches and not expired)
      let ctx = this.store.get(clientId);
      if (!ctx || ctx.token !== token || this.store.isExpired(clientId)) {
        try {
          const v = await this.verify(token);
          ctx = { ...v, token };
          this.store.set(clientId, ctx);
          const chatJid = this.canonicalJid(clientId, ctx);
          setAuthForJid(chatJid, ctx);
          setAuthForJid(`web:${clientId}`, ctx);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : '';
          const code = msg === 'AUTH_EXPIRED' ? 'AUTH_EXPIRED' : 'AUTH_INVALID';
          res.status(401).json({ ok: false, code });
          return;
        }
      }
      const chatJid = this.canonicalJid(clientId, ctx);
      this.jidToClientId.set(chatJid, clientId);

      // Set SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      // Close existing SSE connection for this client
      const existing = this.sseClients.get(clientId);
      if (existing && !existing.writableEnded) {
        existing.end();
      }

      // Store the SSE response for this client
      this.sseClients.set(clientId, res);
      this.replayEvents(
        clientId,
        this.parseLastEventId(req.headers['last-event-id']),
        res,
      );
      this.writeEvent(res, {
        id: null,
        event: 'connected',
        data: { type: 'connected', client_id: clientId },
      });

      logger.info({ clientId }, 'Web: SSE client connected');

      // Clean up on disconnect
      req.on('close', () => {
        if (this.jidToClientId.get(chatJid) === clientId) {
          this.jidToClientId.delete(chatJid);
        }
        this.sseClients.delete(clientId);
        logger.info({ clientId }, 'Web: SSE client disconnected');
      });
    });

    // GET /health
    app.get('/health', (_req: Request, res: Response) => {
      res.json({
        status: 'ok',
        channel: 'web',
        clients: this.sseClients.size,
      });
    });

    await new Promise<void>((resolve) => {
      this.httpServer = app.listen(this.port, () => {
        // Update port in case port 0 was used (OS assigns random port)
        const addr = this.httpServer!.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
        }
        logger.info({ port: this.port }, 'Web: channel server started');
        resolve();
      });
    });

    this.connected = true;
    logger.info('Web channel connected');
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    const clientId = this.jidToClientId.get(jid) ?? jid.replace(/^web:/, '');
    const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.emitEvent(clientId, 'message_delta', {
      message_id: messageId,
      text,
    });
    this.emitEvent(clientId, 'message_end', {
      message_id: messageId,
    });
    logger.info({ jid }, 'Web: message sent via SSE');
  }

  async sendEvent(jid: string, event: string, data: unknown): Promise<void> {
    const clientId = this.jidToClientId.get(jid) ?? jid.replace(/^web:/, '');
    this.emitEvent(clientId, event, data);
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    const clientId = this.jidToClientId.get(jid) ?? jid.replace(/^web:/, '');
    this.emitEvent(clientId, 'typing', { is_typing: isTyping });
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('web:');
  }

  getPort(): number {
    return this.port;
  }

  async disconnect(): Promise<void> {
    // Close all SSE connections
    for (const [, res] of this.sseClients) {
      try {
        if (!res.writableEnded) res.end();
      } catch {
        // ignore
      }
    }
    this.sseClients.clear();
    this.jidToClientId.clear();

    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = null;
    }

    this.connected = false;
    logger.info('Web channel disconnected');
  }

  private parseLastEventId(
    header: string | string[] | undefined,
  ): number | null {
    const raw = Array.isArray(header) ? header[0] : header;
    if (!raw) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private emitEvent(clientId: string, event: string, data: unknown): void {
    const entry = {
      id: this.nextEventId++,
      event,
      data,
    };
    const history = this.sseHistory.get(clientId) ?? [];
    history.push(entry);
    if (history.length > 100) history.shift();
    this.sseHistory.set(clientId, history);

    const res = this.sseClients.get(clientId);
    if (res && !res.writableEnded) {
      this.writeEvent(res, entry);
    }
  }

  private replayEvents(
    clientId: string,
    lastEventId: number | null,
    res: Response,
  ): void {
    if (lastEventId == null) return;
    const history = this.sseHistory.get(clientId) ?? [];
    for (const entry of history) {
      if (entry.id > lastEventId) {
        this.writeEvent(res, entry);
      }
    }
  }

  private writeEvent(
    res: Response,
    entry: { id: number | null; event: string; data: unknown },
  ): void {
    if (entry.id != null) {
      res.write(`id: ${entry.id}\n`);
    }
    res.write(`event: ${entry.event}\n`);
    res.write(`data: ${JSON.stringify(entry.data)}\n\n`);
  }
}

registerChannel('web', (opts) => {
  const envVars = readEnvFile(['WEB_CHANNEL_PORT', 'WEB_CHANNEL_CORS_ORIGIN']);
  const port = parseInt(
    process.env.WEB_CHANNEL_PORT || envVars.WEB_CHANNEL_PORT || '',
    10,
  );
  const corsOrigin =
    process.env.WEB_CHANNEL_CORS_ORIGIN ||
    envVars.WEB_CHANNEL_CORS_ORIGIN ||
    '*';

  if (!port) {
    return null;
  }

  return new WebChannel(opts, port, corsOrigin);
});
