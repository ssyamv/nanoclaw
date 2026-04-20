import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';
import { parseStructuredOutput } from './structured-output.js';

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
        NANOCLAW_DISPATCH_SECRET: 'secret-123',
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

async function runScriptWithPayloadFile(
  args: string[],
  gatewayUrl: string,
  payloadFileName: string,
  payload: unknown,
): Promise<{ stdout: string; stderr: string }> {
  const root = await makeCredentialsDir(gatewayUrl);
  const payloadPath = path.join(root, payloadFileName);
  await fs.writeFile(payloadPath, `${JSON.stringify(payload)}\n`);
  try {
    return await execFileAsync(
      '/bin/bash',
      [SCRIPT_PATH, ...args, `@${payloadPath}`],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: process.env.PATH,
          GATEWAY_URL: gatewayUrl,
          NANOCLAW_DISPATCH_SECRET: 'secret-123',
          ARCFLOW_CREDENTIALS_FILE: path.join(
            root,
            'run',
            'arcflow',
            'credentials.json',
          ),
        },
      },
    );
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
    const parsed = parseStructuredOutput(stdout);
    expect(parsed.cleanText).toContain('查到 1 条');
    expect(parsed.artifacts).toHaveLength(1);
    expect(parsed.artifacts[0].type).toBe('arcflow_card');
    expect(parsed.artifacts[0].title).toBe('我的 Issue');
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
    const parsed = parseStructuredOutput(stdout);
    expect(parsed.cleanText).toContain('需求草稿预览');
    expect(parsed.artifacts).toHaveLength(1);
    expect(parsed.artifacts[0].type).toBe('arcflow_card');
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

  it('workflow callback wraps prd-to-tech success output in the strict envelope', async () => {
    const gateway = await withGatewayServer(() => ({
      body: { ok: true },
    }));
    cleanups.push(gateway.close);
    await runScriptWithPayloadFile(
      ['workflow', 'callback', 'dispatch-1', 'arcflow-prd-to-tech', 'success'],
      gateway.url,
      'prd-to-tech.json',
      {
        tech_doc_path: 'tech-design/2026-04/demo.md',
        content: '# Tech doc',
        plane_issue_id: 'ISS-1',
      },
    );

    expect(gateway.requests).toHaveLength(1);
    expect(gateway.requests[0].method).toBe('POST');
    expect(gateway.requests[0].url).toBe('/api/workflow/callback');
    expect(gateway.requests[0].headers['x-system-secret']).toBe('secret-123');
    expect(JSON.parse(gateway.requests[0].body)).toEqual({
      dispatch_id: 'dispatch-1',
      skill: 'arcflow-prd-to-tech',
      status: 'success',
      output: {
        tech_doc_path: 'tech-design/2026-04/demo.md',
        content: '# Tech doc',
        plane_issue_id: 'ISS-1',
      },
    });
  });

  it('workflow callback wraps tech-to-openapi success output in the strict envelope', async () => {
    const gateway = await withGatewayServer(() => ({
      body: { ok: true },
    }));
    cleanups.push(gateway.close);
    await runScriptWithPayloadFile(
      [
        'workflow',
        'callback',
        'dispatch-2',
        'arcflow-tech-to-openapi',
        'success',
      ],
      gateway.url,
      'tech-to-openapi.json',
      {
        openapi_path: 'api/2026-04/demo.yaml',
        content: 'openapi: 3.0.3',
        plane_issue_id: 'ISS-2',
      },
    );

    expect(gateway.requests).toHaveLength(1);
    expect(JSON.parse(gateway.requests[0].body)).toEqual({
      dispatch_id: 'dispatch-2',
      skill: 'arcflow-tech-to-openapi',
      status: 'success',
      output: {
        openapi_path: 'api/2026-04/demo.yaml',
        content: 'openapi: 3.0.3',
        plane_issue_id: 'ISS-2',
      },
    });
  });

  it('workflow callback wraps bug-analysis success output in the strict envelope', async () => {
    const gateway = await withGatewayServer(() => ({
      body: { ok: true },
    }));
    cleanups.push(gateway.close);
    await runScriptWithPayloadFile(
      [
        'workflow',
        'callback',
        'dispatch-3',
        'arcflow-bug-analysis',
        'success',
      ],
      gateway.url,
      'bug-analysis.json',
      {
        summary: '编译失败',
        root_cause: '缺少依赖',
        suggested_fix: '补充依赖后重试',
        confidence: 'high',
        next_action: 'manual_handoff',
        plane_issue_id: 'ISS-3',
      },
    );

    expect(gateway.requests).toHaveLength(1);
    expect(JSON.parse(gateway.requests[0].body)).toEqual({
      dispatch_id: 'dispatch-3',
      skill: 'arcflow-bug-analysis',
      status: 'success',
      output: {
        summary: '编译失败',
        root_cause: '缺少依赖',
        suggested_fix: '补充依赖后重试',
        confidence: 'high',
        next_action: 'manual_handoff',
        plane_issue_id: 'ISS-3',
      },
    });
  });

  it('rag search uses gateway GET endpoint with system secret header', async () => {
    const gateway = await withGatewayServer(() => ({
      body: {
        chunks: [
          {
            docPath: '产品文档/home.md',
            heading: '概述',
            content: 'Homture 是 AI 相框项目。',
            score: 0.9,
          },
        ],
      },
    }));
    cleanups.push(gateway.close);

    const { stdout } = await runScript(
      ['rag', 'search', '3', '介绍一下 Homture', '5'],
      gateway.url,
    );

    expect(gateway.requests).toHaveLength(1);
    expect(gateway.requests[0].method).toBe('GET');
    expect(gateway.requests[0].url).toContain('/api/rag/search?');
    expect(gateway.requests[0].url).toContain('workspace_id=3');
    expect(gateway.requests[0].headers['x-system-secret']).toBe('secret-123');
    expect(stdout).toContain('产品文档/home.md');
  });

  it('wiki search uses gateway docs endpoint with auth headers', async () => {
    const gateway = await withGatewayServer(() => ({
      body: {
        data: [
          {
            path: '产品文档/home.md',
            name: 'home.md',
            matches: ['Homture 项目总览'],
          },
        ],
      },
    }));
    cleanups.push(gateway.close);

    const { stdout } = await runScript(
      ['wiki', 'search', 'Homture'],
      gateway.url,
    );

    expect(gateway.requests).toHaveLength(1);
    expect(gateway.requests[0].method).toBe('GET');
    expect(gateway.requests[0].url).toContain('/api/docs/search?');
    expect(gateway.requests[0].headers.authorization).toBe('Bearer token-123');
    expect(gateway.requests[0].headers['x-workspace-id']).toBe('3');
    expect(stdout).toContain('产品文档/home.md');
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

  it('issues my returns arcflow_status artifact when result is empty', async () => {
    const gateway = await withGatewayServer(() => ({
      body: {
        items: [],
      },
    }));
    cleanups.push(gateway.close);

    const { stdout } = await runScript(['issues', 'my'], gateway.url);

    const parsed = parseStructuredOutput(stdout);
    expect(parsed.cleanText).toContain('当前没有分配给你的 Issue');
    expect(parsed.artifacts).toHaveLength(1);
    expect(parsed.artifacts[0].type).toBe('arcflow_status');
  });

  it('issues my surfaces gateway errors with non-zero exit', async () => {
    const gateway = await withGatewayServer(() => ({
      status: 502,
      body: {
        error: 'bad gateway',
      },
    }));
    cleanups.push(gateway.close);

    await expect(
      runScript(['issues', 'my'], gateway.url),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('Error: Failed to query my issues'),
    });
  });
});
