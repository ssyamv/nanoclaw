import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface Credentials {
  token: string;
  userId: number;
  workspaceId: number;
  gatewayUrl: string;
  displayName: string;
}

export async function writeCredentialsFile(c: Credentials): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'arcflow-creds-'));
  const filePath = path.join(dir, 'credentials.json');
  await fs.writeFile(filePath, JSON.stringify(c), { mode: 0o400 });
  return filePath;
}

export async function cleanupCredentialsFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
    await fs.rmdir(path.dirname(filePath));
  } catch {
    /* best effort */
  }
}
