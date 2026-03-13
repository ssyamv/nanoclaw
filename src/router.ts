import { Channel, NewMessage } from './types.js';
import { formatLocalTime } from './timezone.js';

export function escapeXml(s: string): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatMessages(
  messages: NewMessage[],
  timezone: string,
): string {
  const lines = messages.map((m) => {
    const displayTime = formatLocalTime(m.timestamp, timezone);
    return `<message sender="${escapeXml(m.sender_name)}" time="${escapeXml(displayTime)}">${escapeXml(m.content)}</message>`;
  });

  const header = `<context timezone="${escapeXml(timezone)}" />\n`;

  return `${header}<messages>\n${lines.join('\n')}\n</messages>`;
}

export function stripInternalTags(text: string): string {
  return text.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
}

/**
 * Detect if text is an API error that should be suppressed from channels.
 * Returns true for transient API failures (network, auth, rate limits).
 */
export function isApiError(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();

  // API error patterns that indicate transient failures
  const errorPatterns = [
    /api error:\s*\d{3}/i, // "API Error: 502", "API Error: 403"
    /failed to authenticate/i, // Auth failures
    /getaddrinfo enotfound/i, // DNS resolution failures
    /econnrefused/i, // Connection refused
    /request not allowed/i, // 403 forbidden
    /bad gateway/i, // 502 errors
    /service unavailable/i, // 503 errors
    /gateway timeout/i, // 504 errors
    /rate limit exceeded/i, // Rate limiting
    /network error/i, // Generic network errors
  ];

  return errorPatterns.some((pattern) => pattern.test(text));
}

export function formatOutbound(rawText: string): string {
  const text = stripInternalTags(rawText);
  if (!text) return '';

  // Suppress API errors from being sent to channels
  if (isApiError(text)) {
    return '';
  }

  return text;
}

export function routeOutbound(
  channels: Channel[],
  jid: string,
  text: string,
): Promise<void> {
  const channel = channels.find((c) => c.ownsJid(jid) && c.isConnected());
  if (!channel) throw new Error(`No channel for JID: ${jid}`);
  return channel.sendMessage(jid, text);
}

export function findChannel(
  channels: Channel[],
  jid: string,
): Channel | undefined {
  return channels.find((c) => c.ownsJid(jid));
}
