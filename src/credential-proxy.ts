/**
 * Credential proxy for container isolation.
 * Containers connect here instead of directly to the Anthropic API.
 * The proxy injects real credentials so containers never see them.
 *
 * Two auth modes:
 *   API key:  Proxy injects x-api-key on every request.
 *   OAuth:    Container CLI exchanges its placeholder token for a temp
 *             API key via /api/oauth/claude_cli/create_api_key.
 *             Proxy injects real OAuth token on that exchange request;
 *             subsequent requests carry the temp key which is valid as-is.
 */
import { createServer, Server } from 'http';
import { request as httpsRequest } from 'https';
import { request as httpRequest, RequestOptions } from 'http';
import { HttpsProxyAgent } from 'https-proxy-agent';

import { readEnvFile } from './env.js';
import { logger } from './logger.js';
import { recordTokenUsage } from './status-tracker.js';

export type AuthMode = 'api-key' | 'oauth';

export interface ProxyConfig {
  authMode: AuthMode;
}

export function startCredentialProxy(
  port: number,
  host = '127.0.0.1',
): Promise<Server> {
  const secrets = readEnvFile([
    'ANTHROPIC_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
  ]);

  const authMode: AuthMode = secrets.ANTHROPIC_API_KEY ? 'api-key' : 'oauth';
  const oauthToken =
    secrets.CLAUDE_CODE_OAUTH_TOKEN || secrets.ANTHROPIC_AUTH_TOKEN;

  const upstreamUrl = new URL(
    secrets.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  );
  const isHttps = upstreamUrl.protocol === 'https:';
  const makeRequest = isHttps ? httpsRequest : httpRequest;

  // Force all requests through local proxy
  const proxyAgent = new HttpsProxyAgent('http://127.0.0.1:7897');

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        const headers: Record<string, string | number | string[] | undefined> =
          {
            ...(req.headers as Record<string, string>),
            host: upstreamUrl.host,
            'content-length': body.length,
          };

        // Strip hop-by-hop headers that must not be forwarded by proxies
        delete headers['connection'];
        delete headers['keep-alive'];
        delete headers['transfer-encoding'];

        if (authMode === 'api-key') {
          // API key mode: inject x-api-key on every request
          delete headers['x-api-key'];
          headers['x-api-key'] = secrets.ANTHROPIC_API_KEY;
        } else {
          // OAuth mode: replace placeholder Bearer token with the real one
          // only when the container actually sends an Authorization header
          // (exchange request + auth probes). Post-exchange requests use
          // x-api-key only, so they pass through without token injection.
          if (headers['authorization']) {
            delete headers['authorization'];
            if (oauthToken) {
              headers['authorization'] = `Bearer ${oauthToken}`;
            }
          }
        }

        // Detect if this is a messages API call (we want to track token usage)
        const isMessagesCall = (req.url ?? '').includes('/messages');
        // Parse request body to detect streaming and model
        let reqModel = '';
        let isStreaming = false;
        if (isMessagesCall && body.length > 0) {
          try {
            const reqJson = JSON.parse(body.toString('utf8'));
            reqModel = String(reqJson.model || '');
            isStreaming = !!reqJson.stream;
          } catch {
            /* ignore parse errors */
          }
        }

        const upstream = makeRequest(
          {
            hostname: upstreamUrl.hostname,
            port: upstreamUrl.port || (isHttps ? 443 : 80),
            path: req.url,
            method: req.method,
            headers,
            agent: proxyAgent,
          } as RequestOptions,
          (upRes) => {
            res.writeHead(upRes.statusCode!, upRes.headers);

            // Only intercept successful messages API calls for token tracking
            if (!isMessagesCall || upRes.statusCode !== 200) {
              upRes.pipe(res);
              return;
            }

            let inputTokens = 0;
            let outputTokens = 0;
            let sseBuffer = '';

            upRes.on('data', (chunk: Buffer) => {
              // Forward to client immediately
              res.write(chunk);

              if (isStreaming) {
                // Parse SSE stream for usage events
                sseBuffer += chunk.toString('utf8');
                const lines = sseBuffer.split('\n');
                sseBuffer = lines.pop() ?? '';
                for (const line of lines) {
                  if (!line.startsWith('data: ')) continue;
                  const data = line.slice(6).trim();
                  if (data === '[DONE]') continue;
                  try {
                    const evt = JSON.parse(data);
                    if (evt.type === 'message_start' && evt.message?.usage) {
                      inputTokens = evt.message.usage.input_tokens ?? 0;
                      if (!reqModel && evt.message.model)
                        reqModel = evt.message.model;
                    } else if (evt.type === 'message_delta' && evt.usage) {
                      outputTokens = evt.usage.output_tokens ?? 0;
                    }
                  } catch {
                    /* ignore */
                  }
                }
              } else {
                // Buffer full response for non-streaming
                sseBuffer += chunk.toString('utf8');
              }
            });

            upRes.on('end', () => {
              res.end();
              // Extract tokens from non-streaming response
              if (!isStreaming && sseBuffer) {
                try {
                  const json = JSON.parse(sseBuffer);
                  if (json.usage) {
                    inputTokens = json.usage.input_tokens ?? 0;
                    outputTokens = json.usage.output_tokens ?? 0;
                  }
                  if (!reqModel && json.model) reqModel = json.model;
                } catch {
                  /* ignore */
                }
              }
              if (inputTokens > 0 || outputTokens > 0) {
                recordTokenUsage(reqModel, inputTokens, outputTokens);
              }
            });
          },
        );

        upstream.on('error', (err) => {
          logger.error(
            { err, url: req.url },
            'Credential proxy upstream error',
          );
          if (!res.headersSent) {
            res.writeHead(502);
            res.end('Bad Gateway');
          }
        });

        upstream.write(body);
        upstream.end();
      });
    });

    server.listen(port, host, () => {
      logger.info({ port, host, authMode }, 'Credential proxy started');
      resolve(server);
    });

    server.on('error', reject);
  });
}

/** Detect which auth mode the host is configured for. */
export function detectAuthMode(): AuthMode {
  const secrets = readEnvFile(['ANTHROPIC_API_KEY']);
  return secrets.ANTHROPIC_API_KEY ? 'api-key' : 'oauth';
}
