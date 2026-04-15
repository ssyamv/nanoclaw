export interface ClientAuth {
  userId: number;
  workspaceId: number;
  displayName: string;
  token: string;
  expiresAt: number; // unix seconds
}

export class ClientAuthStore {
  private map = new Map<string, ClientAuth>();

  set(clientId: string, auth: ClientAuth): void {
    this.map.set(clientId, auth);
  }

  get(clientId: string): ClientAuth | undefined {
    return this.map.get(clientId);
  }

  delete(clientId: string): void {
    this.map.delete(clientId);
  }

  isExpired(clientId: string): boolean {
    const a = this.map.get(clientId);
    if (!a) return true;
    return a.expiresAt * 1000 < Date.now();
  }
}

// Module-level registry keyed by chatJid (e.g. "web:web-1-4") so callers
// outside the channel (container-runner dispatch in index.ts) can look up
// the per-conversation user identity at container spawn time.
const authByJid = new Map<string, ClientAuth>();

export function setAuthForJid(jid: string, auth: ClientAuth): void {
  authByJid.set(jid, auth);
}

export function getAuthForJid(jid: string): ClientAuth | undefined {
  return authByJid.get(jid);
}
