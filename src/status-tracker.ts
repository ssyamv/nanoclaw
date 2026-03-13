/**
 * Shared in-memory state tracker for the status monitor web UI.
 * All modules update this state; the status server reads it.
 */

// Claude model pricing per million tokens (USD)
const MODEL_PRICING: Array<{ prefix: string; input: number; output: number }> = [
  { prefix: 'claude-opus',    input: 15,   output: 75   },
  { prefix: 'claude-sonnet',  input: 3,    output: 15   },
  { prefix: 'claude-haiku',   input: 0.80, output: 4    },
];

function getPricing(model: string): { input: number; output: number } {
  const m = model.toLowerCase();
  for (const p of MODEL_PRICING) {
    if (m.includes(p.prefix.replace('claude-', ''))) return p;
  }
  return { input: 3, output: 15 }; // default to Sonnet pricing
}

export interface StatusState {
  startTime: number;
  pid: number;
  discordConnected: boolean;
  botName: string;
  reconnectCount: number;
  lastReconnectTime: string | null;
  // Token usage (current session since last restart)
  sessionInputTokens: number;
  sessionOutputTokens: number;
  sessionCostUsd: number;
  lastModel: string;
  apiCallCount: number;
}

const state: StatusState = {
  startTime: Date.now(),
  pid: process.pid,
  discordConnected: false,
  botName: '',
  reconnectCount: 0,
  lastReconnectTime: null,
  sessionInputTokens: 0,
  sessionOutputTokens: 0,
  sessionCostUsd: 0,
  lastModel: '',
  apiCallCount: 0,
};

export function getStatus(): StatusState {
  return { ...state };
}

export function setDiscordConnected(
  connected: boolean,
  botName?: string,
): void {
  state.discordConnected = connected;
  if (botName) state.botName = botName;
}

export function recordReconnect(): void {
  state.reconnectCount++;
  const now = new Date();
  state.lastReconnectTime = now.toTimeString().slice(0, 8);
}

export function recordTokenUsage(
  model: string,
  inputTokens: number,
  outputTokens: number,
): void {
  const pricing = getPricing(model);
  const cost =
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output;

  state.sessionInputTokens += inputTokens;
  state.sessionOutputTokens += outputTokens;
  state.sessionCostUsd += cost;
  state.apiCallCount++;
  if (model) state.lastModel = model;

  broadcastStatus();
}

// SSE client registry — status server registers listeners here
type StatusListener = (event: SseEvent) => void;
const listeners = new Set<StatusListener>();

export interface SseEvent {
  type: 'log' | 'status';
  [key: string]: unknown;
}

export function addSseListener(fn: StatusListener): void {
  listeners.add(fn);
}

export function removeSseListener(fn: StatusListener): void {
  listeners.delete(fn);
}

export function broadcastSse(event: SseEvent): void {
  for (const fn of listeners) {
    try {
      fn(event);
    } catch {
      /* ignore dead clients */
    }
  }
}

/** Broadcast the current status snapshot to all SSE clients */
export function broadcastStatus(): void {
  const s = getStatus();
  broadcastSse({
    type: 'status',
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
}
