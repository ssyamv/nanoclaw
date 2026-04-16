import fs from 'node:fs/promises';
import { describe, it, expect } from 'vitest';
import {
  writeCredentialsFile,
  cleanupCredentialsFile,
} from './credentials-file.js';

describe('credentials-file', () => {
  it('writes JSON with mode 0400 and returns path', async () => {
    const filePath = await writeCredentialsFile({
      token: 'jwt.xxx',
      userId: 7,
      workspaceId: 3,
      gatewayUrl: 'http://g',
      displayName: 'U',
    });
    const stat = await fs.stat(filePath);
    expect(stat.mode & 0o777).toBe(0o400);
    const body = JSON.parse(await fs.readFile(filePath, 'utf8'));
    expect(body.token).toBe('jwt.xxx');
    await cleanupCredentialsFile(filePath);
  });

  it('cleanup removes the file', async () => {
    const filePath = await writeCredentialsFile({
      token: 't',
      userId: 1,
      workspaceId: 1,
      gatewayUrl: 'http://g',
      displayName: '',
    });
    await cleanupCredentialsFile(filePath);
    await expect(fs.stat(filePath)).rejects.toThrow();
  });
});
