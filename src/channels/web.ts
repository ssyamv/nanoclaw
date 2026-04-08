import express, { Request, Response } from 'express';
import http from 'http';

import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import { ASSISTANT_NAME } from '../config.js';
import { registerChannel, ChannelOpts } from './registry.js';
import { Channel } from '../types.js';

export class WebChannel implements Channel {
  name = 'web';

  private opts: ChannelOpts;
  private port: number;
  private corsOrigin: string;
  private connected = false;
  private httpServer: http.Server | null = null;
  private sseClients = new Map<string, Response>();

  constructor(opts: ChannelOpts, port: number, corsOrigin: string) {
    this.opts = opts;
    this.port = port;
    this.corsOrigin = corsOrigin;
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
    app.post('/api/chat', (req: Request, res: Response) => {
      const { client_id, message } = req.body || {};

      if (!client_id || !message) {
        res
          .status(400)
          .json({ ok: false, error: 'client_id and message are required' });
        return;
      }

      const chatJid = `web:${client_id}`;
      const timestamp = new Date().toISOString();
      const messageId = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const content = `@${ASSISTANT_NAME} ${message}`.trim();

      this.opts.onChatMetadata(
        chatJid,
        timestamp,
        `Web-${client_id}`,
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

      res.json({ ok: true, message_id: messageId });
    });

    // GET /api/chat/sse — SSE connection for receiving bot responses
    app.get('/api/chat/sse', (req: Request, res: Response) => {
      const clientId = req.query.client_id as string;

      if (!clientId) {
        res
          .status(400)
          .json({ ok: false, error: 'client_id query param is required' });
        return;
      }

      // Set SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      // Send initial connected event
      res.write(
        `event: connected\ndata: ${JSON.stringify({ type: 'connected', client_id: clientId })}\n\n`,
      );

      // Close existing SSE connection for this client
      const existing = this.sseClients.get(clientId);
      if (existing && !existing.writableEnded) {
        existing.end();
      }

      // Store the SSE response for this client
      this.sseClients.set(clientId, res);

      logger.info({ clientId }, 'Web: SSE client connected');

      // Clean up on disconnect
      req.on('close', () => {
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
    const clientId = jid.replace(/^web:/, '');
    const sseRes = this.sseClients.get(clientId);

    if (!sseRes || sseRes.writableEnded) {
      logger.warn({ jid }, 'Web: no SSE client found for jid');
      return;
    }

    const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const data = JSON.stringify({
      message_id: messageId,
      content: text,
      done: true,
    });
    sseRes.write(`event: message\ndata: ${data}\n\n`);
    logger.info({ jid }, 'Web: message sent via SSE');
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    const clientId = jid.replace(/^web:/, '');
    const sseRes = this.sseClients.get(clientId);

    if (!sseRes || sseRes.writableEnded) return;

    const data = JSON.stringify({ is_typing: isTyping });
    sseRes.write(`event: typing\ndata: ${data}\n\n`);
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

    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = null;
    }

    this.connected = false;
    logger.info('Web channel disconnected');
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
