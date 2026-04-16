import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = path.resolve(
  process.cwd(),
  'container/skills/arcflow-api/arcflow-api',
);

interface RecordedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

async function withGatewayServer(
  handler: (
    req: http.IncomingMessage,
    body: string,
  ) => { status?: number; body?: unknown },
): Promise<{
  url: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
}> {
  const requests: RecordedRequest[] = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks).toString('utf8');
    requests.push({
      method: req.method ?? '',
      url: req.url ?? '',
      headers: req.headers,
      body,
    });
    const result = handler(req, body);
    res.statusCode = result.status ?? 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(result.body ?? {}));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to start test server');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: async () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function makeCredentialsDir(gatewayUrl: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nanoclaw-arcflow-api-'));
  await fs.mkdir(path.join(dir, 'run', 'arcflow'), { recursive: true });
  await fs.writeFile(
    path.join(dir, 'run', 'arcflow', 'credentials.json'),
    JSON.stringify({
      token: 'token-123',
      userId: 7,
      workspaceId: 3,
      gatewayUrl,
      displayName: 'Tester',
    }),
  );
  return dir;
}

async function runScript(
  args: string[],
  gatewayUrl: string,
): Promise<{ stdout: string; stderr: string }> {
  const root = await makeCredentialsDir(gatewayUrl);
  try {
    return await execFileAsync('/bin/bash', [SCRIPT_PATH, ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATH: process.env.PATH,
        GATEWAY_URL: gatewayUrl,
        ARCFLOW_CREDENTIALS_FILE: path.join(
          root,
          'run',
          'arcflow',
          'credentials.json',
        ),
      },
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()!();
  }
});

describe('arcflow-api CLI', () => {
  it('issues my sends authenticated request with workspace header', async () => {
    const gateway = await withGatewayServer(() => ({
      body: {
        items: [{ id: 'ISS-1', name: 'Need review' }],
      },
    }));
    cleanups.push(gateway.close);

    const { stdout } = await runScript(['issues', 'my'], gateway.url);

    expect(gateway.requests).toHaveLength(1);
    expect(gateway.requests[0].method).toBe('GET');
    expect(gateway.requests[0].url).toBe('/api/arcflow/issues');
    expect(gateway.requests[0].headers.authorization).toBe('Bearer token-123');
    expect(gateway.requests[0].headers['x-workspace-id']).toBe('3');
    expect(stdout).toContain('"id": "ISS-1"');
  });

  it('requirements draft defaults to dryRun true', async () => {
    const gateway = await withGatewayServer((_req, _body) => ({
      body: {
        mode: 'dry_run',
        path: 'requirements/2026-04/demo.md',
        preview: '# Demo',
      },
    }));
    cleanups.push(gateway.close);

    const { stdout } = await runScript(
      ['requirements', 'draft', '统一登录改造', '需要支持 SSO 与权限分级'],
      gateway.url,
    );

    expect(gateway.requests).toHaveLength(1);
    expect(gateway.requests[0].method).toBe('POST');
    expect(gateway.requests[0].url).toBe('/api/arcflow/requirements/drafts');
    expect(gateway.requests[0].headers.authorization).toBe('Bearer token-123');
    expect(gateway.requests[0].headers['x-workspace-id']).toBe('3');
    expect(JSON.parse(gateway.requests[0].body)).toEqual({
      title: '统一登录改造',
      content: '需要支持 SSO 与权限分级',
      dryRun: true,
    });
    expect(stdout).toContain('"mode": "dry_run"');
  });

  it('requirements draft --execute sends dryRun false', async () => {
    const gateway = await withGatewayServer((_req, _body) => ({
      status: 201,
      body: {
        mode: 'created',
        path: 'requirements/2026-04/demo.md',
        preview: '# Demo',
      },
    }));
    cleanups.push(gateway.close);

    await runScript(
      [
        'requirements',
        'draft',
        '统一登录改造',
        '需要支持 SSO 与权限分级',
        '--execute',
      ],
      gateway.url,
    );

    expect(JSON.parse(gateway.requests[0].body)).toEqual({
      title: '统一登录改造',
      content: '需要支持 SSO 与权限分级',
      dryRun: false,
    });
  });

  it('memory snapshot uses workspace from credentials by default', async () => {
    const gateway = await withGatewayServer(() => ({
      body: {
        workspace: { id: 3, slug: 'acme' },
        recent_user_actions: [
          { action_type: 'nanoclaw.dispatch.arcflow-prd-to-tech' },
        ],
      },
    }));
    cleanups.push(gateway.close);

    const { stdout } = await runScript(['memory', 'snapshot'], gateway.url);

    expect(gateway.requests).toHaveLength(1);
    expect(gateway.requests[0].method).toBe('GET');
    expect(gateway.requests[0].url).toBe('/api/memory/snapshot?workspace_id=3');
    expect(gateway.requests[0].headers.authorization).toBe('Bearer token-123');
    expect(gateway.requests[0].headers['x-workspace-id']).toBe('3');
    expect(stdout).toContain('"slug": "acme"');
  });
});
