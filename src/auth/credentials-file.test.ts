import fs from 'node:fs/promises';

import { afterEach, describe, expect, it } from 'vitest';

import {
  cleanupCredentialsFile,
  writeCredentialsFile,
} from './credentials-file.js';

const createdFiles: string[] = [];

afterEach(async () => {
  while (createdFiles.length > 0) {
    await cleanupCredentialsFile(createdFiles.pop()!);
  }
});

describe('writeCredentialsFile', () => {
  it('writes credentials with group-readable permissions for container access', async () => {
    const filePath = await writeCredentialsFile({
      token: 'token-123',
      userId: 1,
      workspaceId: 2,
      gatewayUrl: 'http://gateway',
      displayName: 'Tester',
    });
    createdFiles.push(filePath);

    const stat = await fs.stat(filePath);
    expect(stat.mode & 0o440).toBe(0o440);
  });
});
