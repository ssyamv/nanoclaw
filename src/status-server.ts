/**
 * Lightweight HTTP status monitor server (no external dependencies).
 * Serves the web dashboard and SSE stream for real-time updates.
 *
 * Default port: 3030  (set STATUS_PORT env var to override)
 */

import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

import { logger } from './logger.js';
import {
  addSseListener,
  broadcastSse,
  broadcastStatus,
  getStatus,
  removeSseListener,
  type SseEvent,
} from './status-tracker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Read the UI HTML once at startup (resolve from dist/ → src/ sibling)
function loadUiHtml(): string {
  const candidates = [
    path.join(__dirname, 'status-ui.html'),
    path.join(__dirname, '..', 'src', 'status-ui.html'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  }
  return '<h1>UI file not found</h1>';
}

// Strip ANSI escape codes
function stripAnsi(s: string): string {
  return s.replace(/\x1B\[[0-9;]*m/g, '');
}

// pino-pretty line format: [HH:MM:SS.mmm] LEVEL (pid): message
//   optionally followed by indented key: value lines
const PINO_RE =
  /^\[(\d{2}:\d{2}:\d{2})\.\d{3}\]\s+(TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\s+\(\d+\):\s+(.+)$/;

function parsePinoLine(raw: string): void {
  const line = stripAnsi(raw.trim());
  const m = line.match(PINO_RE);
  if (!m) return;
  const [, time, levelRaw, msg] = m;
  broadcastSse({
    type: 'log',
    level: levelRaw.toLowerCase(),
    time,
    msg: msg.slice(0, 300),
    data: {},
  });
}

/**
 * Tail the nanoclaw log file and broadcast new lines as SSE log events.
 * Starts from the current end-of-file so we only stream new entries.
 */
function startLogTail(logPath: string): void {
  let offset = 0;
  let lineBuffer = '';

  // Start from current EOF — only stream new lines going forward
  try {
    offset = fs.statSync(logPath).size;
  } catch {
    /* file may not exist yet */
  }

  const readNew = () => {
    try {
      const size = fs.statSync(logPath).size;
      if (size < offset) {
        offset = 0;
        lineBuffer = '';
      } // log rotated
      if (size <= offset) return;

      const buf = Buffer.alloc(size - offset);
      const fd = fs.openSync(logPath, 'r');
      fs.readSync(fd, buf, 0, buf.length, offset);
      fs.closeSync(fd);
      offset = size;

      lineBuffer += buf.toString('utf8');
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() ?? '';
      for (const line of lines) parsePinoLine(line);
    } catch {
      /* ignore transient errors */
    }
  };

  fs.watchFile(logPath, { interval: 500, persistent: false }, readNew);
}

export function startStatusServer(): void {
  const port = parseInt(process.env.STATUS_PORT || '3030', 10);
  const ui = loadUiHtml();
  const logPath = path.join(__dirname, '..', 'logs', 'nanoclaw.log');

  // Start tailing the log file
  startLogTail(logPath);

  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';

    // ── Dashboard HTML ──────────────────────────────────────
    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(ui);
      return;
    }

    // ── Status JSON snapshot ────────────────────────────────
    if (url === '/api/status') {
      const s = getStatus();
      const body = JSON.stringify({
        discord: s.discordConnected,
        uptime: Math.floor((Date.now() - s.startTime) / 1000),
        botName: s.botName,
        reconnects: s.reconnectCount,
        lastReconnect: s.lastReconnectTime,
        pid: s.pid,
        sessionInputTokens: s.sessionInputTokens,
        sessionOutputTokens: s.sessionOutputTokens,
        sessionCostUsd: s.sessionCostUsd,
        lastModel: s.lastModel,
        apiCallCount: s.apiCallCount,
      });
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(body);
      return;
    }

    // ── SSE stream ──────────────────────────────────────────
    if (url === '/api/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      // Send an immediate status snapshot so the client isn't blank
      const snap = getStatus();
      const initial: SseEvent = {
        type: 'status',
        discord: snap.discordConnected,
        uptime: Math.floor((Date.now() - snap.startTime) / 1000),
        botName: snap.botName,
        reconnects: snap.reconnectCount,
        lastReconnect: snap.lastReconnectTime,
        pid: snap.pid,
      };
      res.write(`data: ${JSON.stringify(initial)}\n\n`);

      // Register listener
      const listener = (event: SseEvent) => {
        try {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        } catch {
          cleanup();
        }
      };

      addSseListener(listener);

      // Keep-alive ping every 15s
      const ping = setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch {
          cleanup();
        }
      }, 15_000);

      const cleanup = () => {
        clearInterval(ping);
        removeSseListener(listener);
        try {
          res.end();
        } catch {
          /* already closed */
        }
      };

      req.on('close', cleanup);
      req.on('aborted', cleanup);
      return;
    }

    // ── 404 ─────────────────────────────────────────────────
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  server.listen(port, '127.0.0.1', () => {
    logger.info({ port }, 'Status monitor running');
    console.log(`\n  📊 Status monitor: http://localhost:${port}\n`);
  });

  // Broadcast a fresh status snapshot every 10 seconds
  setInterval(broadcastStatus, 10_000);
}
