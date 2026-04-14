import crypto from 'crypto';
import axios from 'axios';

import { logger } from '../logger.js';

export interface JwtPayload {
  user_id: number;
  username?: string;
  exp?: number;
  iat?: number;
  [k: string]: unknown;
}

export interface AuthContext {
  user_id: number;
  username: string;
  workspace_id: number;
  workspace_slug?: string;
  role: string;
}

export class JwtError extends Error {
  code: 'invalid' | 'expired' | 'malformed';
  constructor(code: 'invalid' | 'expired' | 'malformed', msg: string) {
    super(msg);
    this.code = code;
  }
}

function b64urlDecode(input: string): Buffer {
  const pad = 4 - (input.length % 4);
  const normalized =
    input.replace(/-/g, '+').replace(/_/g, '/') +
    (pad < 4 ? '='.repeat(pad) : '');
  return Buffer.from(normalized, 'base64');
}

function b64urlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * Verify an HS256-signed JWT against the shared secret.
 * Throws JwtError on any failure. Returns the decoded payload on success.
 */
export function verifyJwt(token: string, secret: string): JwtPayload {
  if (!token || typeof token !== 'string') {
    throw new JwtError('malformed', 'empty token');
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new JwtError('malformed', 'token must have 3 parts');
  }
  const [headerB64, payloadB64, sigB64] = parts;

  let header: { alg?: string; typ?: string };
  try {
    header = JSON.parse(b64urlDecode(headerB64).toString('utf8'));
  } catch {
    throw new JwtError('malformed', 'invalid header');
  }
  if (header.alg !== 'HS256') {
    throw new JwtError('invalid', `unsupported alg: ${header.alg}`);
  }

  const expectedSig = b64urlEncode(
    crypto
      .createHmac('sha256', secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest(),
  );
  const sigA = Buffer.from(sigB64);
  const sigB = Buffer.from(expectedSig);
  if (sigA.length !== sigB.length || !crypto.timingSafeEqual(sigA, sigB)) {
    throw new JwtError('invalid', 'signature mismatch');
  }

  let payload: JwtPayload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8'));
  } catch {
    throw new JwtError('malformed', 'invalid payload');
  }

  if (typeof payload.exp === 'number') {
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      throw new JwtError('expired', 'token expired');
    }
  }
  if (typeof payload.user_id !== 'number') {
    throw new JwtError('invalid', 'missing user_id');
  }
  return payload;
}

interface CacheEntry {
  value: {
    role: string;
    workspace_slug?: string;
    username?: string;
  } | null; // null == denied
  expiresAt: number;
}

export interface WorkspacePermissionFetcher {
  (
    userId: number,
    workspaceId: number,
    token: string,
  ): Promise<{
    role: string;
    workspace_slug?: string;
    username?: string;
  } | null>;
}

/**
 * In-memory permission cache with TTL. Caches both allows (role) and denies
 * (null) to avoid hot-path spam; callers re-check after TTL expiry.
 */
export class WorkspacePermissionCache {
  private store = new Map<string, CacheEntry>();
  private ttlMs: number;
  private fetcher: WorkspacePermissionFetcher;

  constructor(fetcher: WorkspacePermissionFetcher, ttlMs = 60_000) {
    this.fetcher = fetcher;
    this.ttlMs = ttlMs;
  }

  private key(userId: number, workspaceId: number): string {
    return `${userId}:${workspaceId}`;
  }

  async check(
    userId: number,
    workspaceId: number,
    token: string,
  ): Promise<CacheEntry['value']> {
    const k = this.key(userId, workspaceId);
    const hit = this.store.get(k);
    const now = Date.now();
    if (hit && hit.expiresAt > now) return hit.value;

    const value = await this.fetcher(userId, workspaceId, token);
    this.store.set(k, { value, expiresAt: now + this.ttlMs });
    return value;
  }

  /** For tests */
  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }
}

/**
 * Default fetcher: hits Gateway `GET /api/workspaces/:id/members/me`.
 * Returns null on 401/403/404, throws on network / 5xx errors.
 */
export function gatewayPermissionFetcher(
  gatewayBaseUrl: string,
): WorkspacePermissionFetcher {
  return async (_userId, workspaceId, token) => {
    const url = `${gatewayBaseUrl.replace(/\/+$/, '')}/api/workspaces/${workspaceId}/members/me`;
    try {
      const resp = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5_000,
        validateStatus: () => true,
      });
      if (resp.status === 200 && resp.data) {
        const body = resp.data;
        const role =
          body.role ?? body.data?.role ?? body.member?.role ?? undefined;
        if (!role) return null;
        return {
          role,
          workspace_slug:
            body.workspace_slug ??
            body.data?.workspace_slug ??
            body.workspace?.slug,
          username: body.username ?? body.data?.username,
        };
      }
      if (resp.status === 401 || resp.status === 403 || resp.status === 404) {
        return null;
      }
      throw new Error(`gateway ${resp.status}`);
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, workspaceId },
        'Workspace permission lookup failed',
      );
      throw err;
    }
  };
}

/** Format the system-prompt context block injected into Agent prompts. */
export function formatSystemContext(ctx: AuthContext, nowIso?: string): string {
  const ts = nowIso ?? new Date().toISOString();
  const slug = ctx.workspace_slug ? ` (slug=${ctx.workspace_slug})` : '';
  return [
    '[CURRENT CONTEXT]',
    `- user_id: ${ctx.user_id}`,
    `- username: ${ctx.username}`,
    `- workspace_id: ${ctx.workspace_id}${slug}`,
    `- workspace_role: ${ctx.role}`,
    `- timestamp: ${ts}`,
  ].join('\n');
}
