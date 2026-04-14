import express, { NextFunction, Request, Response } from 'express';
import http from 'http';

import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import { ASSISTANT_NAME } from '../config.js';
import { registerChannel, ChannelOpts } from './registry.js';
import { Channel } from '../types.js';
import {
  AuthContext,
  JwtError,
  WorkspacePermissionCache,
  WorkspacePermissionFetcher,
  formatSystemContext,
  gatewayPermissionFetcher,
  verifyJwt,
} from './web-auth.js';

const RING_BUFFER_SIZE = 200;
const TURN_TIMEOUT_MS = 5 * 60 * 1000;
const SSE_HEARTBEAT_MS = 15_000;

export type SseEventType =
  | 'connected'
  | 'session_start'
  | 'thinking_start'
  | 'thinking_delta'
  | 'thinking_end'
  | 'message_delta'
  | 'tool_call_start'
  | 'tool_call_progress'
  | 'tool_call_end'
  | 'artifact'
  | 'skill_loaded'
  | 'message_end'
  | 'error'
  | 'done'
  // legacy event types, preserved for backwards compat with existing web client
  | 'message'
  | 'typing';

interface BufferedEvent {
  id: number;
  event: SseEventType;
  data: unknown;
}

interface ClientState {
  ring: BufferedEvent[];
  nextId: number;
  res: Response | null;
  heartbeat: ReturnType<typeof setInterval> | null;
  inflightMessageId: string | null;
  turnTimer: ReturnType<typeof setTimeout> | null;
  authContext: AuthContext | null;
}

export interface WebChannelConfig {
  port: number;
  corsOrigin: string;
  jwtSecret: string | null;
  gatewayBaseUrl: string | null;
  permissionCacheTtlMs?: number;
  /** Override for tests. */
  permissionFetcher?: WorkspacePermissionFetcher;
}

export class WebChannel implements Channel {
  name = 'web';

  private opts: ChannelOpts;
  private cfg: WebChannelConfig;
  private connected = false;
  private httpServer: http.Server | null = null;
  private clients = new Map<string, ClientState>();
  private permCache: WorkspacePermissionCache | null;

  constructor(opts: ChannelOpts, cfg: WebChannelConfig) {
    this.opts = opts;
    this.cfg = cfg;
    if (cfg.gatewayBaseUrl) {
      const fetcher =
        cfg.permissionFetcher ?? gatewayPermissionFetcher(cfg.gatewayBaseUrl);
      this.permCache = new WorkspacePermissionCache(
        fetcher,
        cfg.permissionCacheTtlMs,
      );
    } else if (cfg.permissionFetcher) {
      this.permCache = new WorkspacePermissionCache(
        cfg.permissionFetcher,
        cfg.permissionCacheTtlMs,
      );
    } else {
      this.permCache = null;
    }
  }

  // ---- lifecycle ----------------------------------------------------------

  async connect(): Promise<void> {
    const app = express();
    app.use(express.json());

    // CORS
    app.use((req: Request, res: Response, next) => {
      res.setHeader('Access-Control-Allow-Origin', this.cfg.corsOrigin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Workspace-Id, Last-Event-ID',
      );
      res.setHeader('Access-Control-Expose-Headers', 'X-Last-Event-Id');
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
      next();
    });

    // Auth guard — applied to /api/chat and /api/chat/sse only.
    const auth = (req: Request, res: Response, next: NextFunction): void => {
      this.authenticate(req, res)
        .then((ok) => {
          if (ok) next();
        })
        .catch((err) => {
          logger.error(
            { err: (err as Error).message },
            'Web: auth middleware error',
          );
          if (!res.headersSent) {
            res.status(500).json({ ok: false, error: 'auth_internal_error' });
          }
        });
    };

    app.post('/api/chat', auth, (req: Request, res: Response) => {
      this.handleChatPost(req, res);
    });

    app.get('/api/chat/sse', auth, (req: Request, res: Response) => {
      this.handleSseConnect(req, res);
    });

    app.get('/health', (_req: Request, res: Response) => {
      res.json({
        status: 'ok',
        channel: 'web',
        clients: this.clients.size,
        auth: this.cfg.jwtSecret ? 'jwt' : 'disabled',
      });
    });

    await new Promise<void>((resolve) => {
      this.httpServer = app.listen(this.cfg.port, () => {
        const addr = this.httpServer!.address();
        if (addr && typeof addr === 'object') this.cfg.port = addr.port;
        logger.info({ port: this.cfg.port }, 'Web: channel server started');
        resolve();
      });
    });

    this.connected = true;
    logger.info('Web channel connected');
  }

  async disconnect(): Promise<void> {
    for (const [, st] of this.clients) {
      if (st.heartbeat) clearInterval(st.heartbeat);
      if (st.turnTimer) clearTimeout(st.turnTimer);
      if (st.res && !st.res.writableEnded) {
        try {
          st.res.end();
        } catch {
          /* ignore */
        }
      }
    }
    this.clients.clear();

    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = null;
    }

    this.connected = false;
    logger.info('Web channel disconnected');
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('web:');
  }

  getPort(): number {
    return this.cfg.port;
  }

  // ---- Channel outbound (legacy + SSE events) -----------------------------

  async sendMessage(jid: string, text: string): Promise<void> {
    const clientId = jid.replace(/^web:/, '');
    const state = this.clients.get(clientId);
    if (!state) {
      logger.warn({ jid }, 'Web: no client state for jid');
      return;
    }

    // Emit as `message_delta` + `message_end` + `done` to follow spec §6.2,
    // while keeping the legacy `message` event for clients not yet migrated.
    const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.emit(clientId, 'message_delta', { text });
    this.emit(clientId, 'message_end', { message_id: messageId });
    this.emit(clientId, 'done', {});

    // Legacy shape for back-compat with the current web client.
    this.emit(clientId, 'message', {
      message_id: messageId,
      content: text,
      done: true,
    });

    this.finishTurn(clientId);
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    const clientId = jid.replace(/^web:/, '');
    this.emit(clientId, 'typing', { is_typing: isTyping });
  }

  /**
   * Build the per-jid system context block used by the Agent prompt pipeline.
   * Returns null when no authenticated context is available for this jid.
   */
  buildSystemContext(jid: string): string | null {
    const clientId = jid.replace(/^web:/, '');
    const st = this.clients.get(clientId);
    if (!st || !st.authContext) return null;
    return formatSystemContext(st.authContext);
  }

  /**
   * Public emit API — Agent-loop code may call this to stream thinking / tool
   * call / artifact events. `done` terminates the current in-flight turn.
   */
  emitEvent(jid: string, type: SseEventType, data: unknown): void {
    const clientId = jid.replace(/^web:/, '');
    this.emit(clientId, type, data);
    if (type === 'done') this.finishTurn(clientId);
  }

  // ---- internal: auth -----------------------------------------------------

  private async authenticate(req: Request, res: Response): Promise<boolean> {
    if (!this.cfg.jwtSecret) {
      // Auth disabled (test/dev). Attach a default anonymous context only if
      // a workspace header is present; otherwise leave unset.
      return true;
    }
    const header =
      (req.headers.authorization as string | undefined) ??
      (req.headers.Authorization as unknown as string | undefined);
    if (!header || !header.startsWith('Bearer ')) {
      res.status(401).json({ ok: false, error: 'missing_bearer_token' });
      return false;
    }
    const token = header.slice('Bearer '.length).trim();

    let payload;
    try {
      payload = verifyJwt(token, this.cfg.jwtSecret);
    } catch (err) {
      const code =
        err instanceof JwtError && err.code === 'expired'
          ? 'token_expired'
          : 'invalid_token';
      res.status(401).json({ ok: false, error: code });
      return false;
    }

    const workspaceIdRaw =
      (req.headers['x-workspace-id'] as string | undefined) ??
      (req.query.workspace_id as string | undefined);
    if (!workspaceIdRaw) {
      res.status(400).json({ ok: false, error: 'missing_x_workspace_id' });
      return false;
    }
    const workspaceId = parseInt(workspaceIdRaw, 10);
    if (!Number.isFinite(workspaceId) || workspaceId <= 0) {
      res.status(400).json({ ok: false, error: 'invalid_x_workspace_id' });
      return false;
    }

    // Permission check via cache (TTL 60s).
    let perm: Awaited<ReturnType<WorkspacePermissionCache['check']>> = null;
    if (this.permCache) {
      try {
        perm = await this.permCache.check(payload.user_id, workspaceId, token);
      } catch {
        res.status(502).json({ ok: false, error: 'permission_lookup_failed' });
        return false;
      }
      if (!perm) {
        res.status(403).json({ ok: false, error: 'workspace_forbidden' });
        return false;
      }
    } else {
      perm = { role: 'member' }; // dev-mode fallback when gateway not configured
    }

    const ctx: AuthContext = {
      user_id: payload.user_id,
      username: perm.username ?? payload.username ?? `user-${payload.user_id}`,
      workspace_id: workspaceId,
      workspace_slug: perm.workspace_slug,
      role: perm.role,
    };
    (req as Request & { auth: AuthContext }).auth = ctx;
    return true;
  }

  // ---- internal: POST /api/chat ------------------------------------------

  private handleChatPost(req: Request, res: Response): void {
    const { client_id, message } = (req.body ?? {}) as {
      client_id?: string;
      message?: string;
    };
    if (!client_id || !message) {
      res
        .status(400)
        .json({ ok: false, error: 'client_id and message are required' });
      return;
    }
    const state = this.ensureClient(client_id);
    const auth = (req as Request & { auth?: AuthContext }).auth;
    if (auth) state.authContext = auth;

    if (state.inflightMessageId) {
      res.status(429).json({
        ok: false,
        error: 'busy',
        inflight_message_id: state.inflightMessageId,
      });
      return;
    }

    const chatJid = `web:${client_id}`;
    const timestamp = new Date().toISOString();
    const messageId = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const content = `@${ASSISTANT_NAME} ${message}`.trim();

    this.opts.onChatMetadata(
      chatJid,
      timestamp,
      auth?.username ? `Web-${auth.username}` : `Web-${client_id}`,
      'web',
      false,
    );

    this.opts.onMessage(chatJid, {
      id: messageId,
      chat_jid: chatJid,
      sender: auth?.username ?? client_id,
      sender_name: auth?.username ?? client_id,
      content,
      timestamp,
    });

    // Begin turn bookkeeping.
    state.inflightMessageId = messageId;
    if (state.turnTimer) clearTimeout(state.turnTimer);
    state.turnTimer = setTimeout(() => {
      logger.warn({ client_id }, 'Web: turn timeout — force-closing');
      this.emit(client_id, 'error', {
        code: 'turn_timeout',
        message: 'Agent turn exceeded timeout',
        retriable: true,
      });
      this.emit(client_id, 'done', {});
      this.finishTurn(client_id);
    }, TURN_TIMEOUT_MS);

    this.emit(client_id, 'session_start', {
      conversation_id: chatJid,
      agent_ready_at: timestamp,
      message_id: messageId,
    });

    res.status(202).json({ ok: true, message_id: messageId });
  }

  // ---- internal: GET /api/chat/sse ---------------------------------------

  private handleSseConnect(req: Request, res: Response): void {
    const clientId = req.query.client_id as string | undefined;
    if (!clientId) {
      res
        .status(400)
        .json({ ok: false, error: 'client_id query param is required' });
      return;
    }
    const state = this.ensureClient(clientId);
    const auth = (req as Request & { auth?: AuthContext }).auth;
    if (auth) state.authContext = auth;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Close any existing SSE connection for the same client — only one live
    // tail per client_id.
    if (state.res && !state.res.writableEnded) {
      try {
        state.res.end();
      } catch {
        /* ignore */
      }
    }
    if (state.heartbeat) clearInterval(state.heartbeat);

    state.res = res;

    // Replay from Last-Event-ID when present.
    const lastEventIdHeader =
      (req.headers['last-event-id'] as string | undefined) ??
      (req.query.last_event_id as string | undefined);
    let replayFrom = -1;
    if (lastEventIdHeader) {
      const n = parseInt(lastEventIdHeader, 10);
      if (Number.isFinite(n)) replayFrom = n;
    }

    if (replayFrom >= 0) {
      const missed = state.ring.filter((e) => e.id > replayFrom);
      for (const ev of missed) this.writeSse(res, ev);
      // If the buffer was overrun, hint the client to refetch canonical state.
      const oldest = state.ring.length ? state.ring[0].id : replayFrom + 1;
      if (oldest > replayFrom + 1) {
        this.writeSse(res, {
          id: state.nextId,
          event: 'error',
          data: {
            code: 'buffer_overrun',
            message: 'replay buffer overflowed; refetch latest state',
            retriable: false,
          },
        });
      }
    }

    // Always send a fresh `connected` event (not added to ring — transport-level).
    res.write(
      `event: connected\ndata: ${JSON.stringify({ type: 'connected', client_id: clientId })}\n\n`,
    );

    // Heartbeat
    state.heartbeat = setInterval(() => {
      if (!state.res || state.res.writableEnded) return;
      try {
        state.res.write(`: ping ${Date.now()}\n\n`);
      } catch {
        /* ignore */
      }
    }, SSE_HEARTBEAT_MS);

    logger.info({ clientId, replayFrom }, 'Web: SSE client connected');

    req.on('close', () => {
      if (state.heartbeat) {
        clearInterval(state.heartbeat);
        state.heartbeat = null;
      }
      // Don't delete client state — ring buffer must survive reconnect.
      state.res = null;
      logger.info({ clientId }, 'Web: SSE client disconnected');
    });
  }

  // ---- internal: helpers --------------------------------------------------

  private ensureClient(clientId: string): ClientState {
    let s = this.clients.get(clientId);
    if (!s) {
      s = {
        ring: [],
        nextId: 1,
        res: null,
        heartbeat: null,
        inflightMessageId: null,
        turnTimer: null,
        authContext: null,
      };
      this.clients.set(clientId, s);
    }
    return s;
  }

  private emit(clientId: string, event: SseEventType, data: unknown): void {
    const state = this.ensureClient(clientId);
    const ev: BufferedEvent = { id: state.nextId++, event, data };
    state.ring.push(ev);
    if (state.ring.length > RING_BUFFER_SIZE) {
      state.ring.splice(0, state.ring.length - RING_BUFFER_SIZE);
    }
    if (state.res && !state.res.writableEnded) {
      this.writeSse(state.res, ev);
    }
  }

  private writeSse(res: Response, ev: BufferedEvent): void {
    try {
      res.write(
        `id: ${ev.id}\nevent: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`,
      );
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Web: SSE write failed');
    }
  }

  private finishTurn(clientId: string): void {
    const st = this.clients.get(clientId);
    if (!st) return;
    st.inflightMessageId = null;
    if (st.turnTimer) {
      clearTimeout(st.turnTimer);
      st.turnTimer = null;
    }
  }
}

registerChannel('web', (opts) => {
  const envVars = readEnvFile([
    'WEB_CHANNEL_PORT',
    'WEB_CHANNEL_CORS_ORIGIN',
    'ARCFLOW_JWT_SECRET',
    'ARCFLOW_GATEWAY_URL',
  ]);
  const port = parseInt(
    process.env.WEB_CHANNEL_PORT || envVars.WEB_CHANNEL_PORT || '',
    10,
  );
  const corsOrigin =
    process.env.WEB_CHANNEL_CORS_ORIGIN ||
    envVars.WEB_CHANNEL_CORS_ORIGIN ||
    '*';
  const jwtSecret =
    process.env.ARCFLOW_JWT_SECRET || envVars.ARCFLOW_JWT_SECRET || null;
  const gatewayBaseUrl =
    process.env.ARCFLOW_GATEWAY_URL || envVars.ARCFLOW_GATEWAY_URL || null;

  if (!port) return null;

  return new WebChannel(opts, { port, corsOrigin, jwtSecret, gatewayBaseUrl });
});
