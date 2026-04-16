import { describe, expect, it } from 'vitest';

import { buildAutoRegisteredWebGroup } from './index.js';

describe('buildAutoRegisteredWebGroup', () => {
  it('creates a non-triggered web group for new web chat jids', () => {
    const group = buildAutoRegisteredWebGroup('web:user-1');
    expect(group).toMatchObject({
      name: 'Web-user-1',
      folder: 'web-user-1',
      trigger: '@Andy',
      requiresTrigger: false,
    });
    expect(group?.added_at).toBeTypeOf('string');
  });

  it('reuses the same folder for the same web user across conversations', () => {
    const first = buildAutoRegisteredWebGroup('web:web-42-1');
    const second = buildAutoRegisteredWebGroup('web:user-42');

    expect(first?.folder).toBe('web-user-42');
    expect(second?.folder).toBe('web-user-42');
  });

  it('isolates folders for different web users', () => {
    const first = buildAutoRegisteredWebGroup('web:web-7-1');
    const second = buildAutoRegisteredWebGroup('web:web-8-1');

    expect(first?.folder).toBe('web-user-7');
    expect(second?.folder).toBe('web-user-8');
  });

  it('returns null for non-web chats', () => {
    expect(buildAutoRegisteredWebGroup('telegram:123')).toBeNull();
  });
});
