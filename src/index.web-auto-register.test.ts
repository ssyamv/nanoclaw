import { describe, expect, it } from 'vitest';

import { buildAutoRegisteredWebGroup } from './index.js';

describe('buildAutoRegisteredWebGroup', () => {
  it('creates a non-triggered web group for new web chat jids', () => {
    const group = buildAutoRegisteredWebGroup('web:web-1-5');
    expect(group).toMatchObject({
      name: 'Web-web-1-5',
      folder: 'web',
      trigger: '@Andy',
      requiresTrigger: false,
    });
    expect(group?.added_at).toBeTypeOf('string');
  });

  it('returns null for non-web chats', () => {
    expect(buildAutoRegisteredWebGroup('telegram:123')).toBeNull();
  });
});
