/**
 * Shared in-memory state tracker for the status monitor web UI.
 * All modules update this state; the status server reads it.
 */

export interface StatusState {
  startTime: number;
  pid: number;
  discordConnected: boolean;
  botName: string;
  reconnectCount: number;
  lastReconnectTime: string | null;
}

const state: StatusState = {
  startTime: Date.now(),
  pid: process.pid,
  discordConnected: false,
  botName: '',
  reconnectCount: 0,
  lastReconnectTime: null,
};

export function getStatus(): StatusState {
  return { ...state };
}

export function setDiscordConnected(connected: boolean, botName?: string): void {
  state.discordConnected = connected;
  if (botName) state.botName = botName;
}

export function recordReconnect(): void {
  state.reconnectCount++;
  const now = new Date();
  state.lastReconnectTime = now.toTimeString().slice(0, 8);
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
    try { fn(event); } catch { /* ignore dead clients */ }
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
  });
}
