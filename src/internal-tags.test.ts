import { describe, expect, it } from 'vitest';

import {
  createInternalTagState,
  flushInternalTagState,
  parseInternalTaggedDelta,
} from '../container/agent-runner/src/internal-tags.ts';

describe('internal tag parser', () => {
  it('splits visible text and thinking blocks', () => {
    const state = createInternalTagState();
    const events = parseInternalTaggedDelta(
      'Hello<internal>thinking</internal>world',
      state,
    );

    expect(events).toEqual([
      { type: 'message_delta', text: 'Hello' },
      { type: 'thinking_start' },
      { type: 'thinking_delta', text: 'thinking' },
      { type: 'thinking_end' },
      { type: 'message_delta', text: 'world' },
    ]);
  });

  it('handles markers split across deltas', () => {
    const state = createInternalTagState();
    const first = parseInternalTaggedDelta('Hi<inte', state);
    const second = parseInternalTaggedDelta('rnal>abc</inte', state);
    const third = parseInternalTaggedDelta('rnal>done', state);
    const flush = flushInternalTagState(state);

    expect(first).toEqual([{ type: 'message_delta', text: 'Hi' }]);
    expect(second).toEqual([
      { type: 'thinking_start' },
      { type: 'thinking_delta', text: 'abc' },
    ]);
    expect(third).toEqual([
      { type: 'thinking_end' },
      { type: 'message_delta', text: 'done' },
    ]);
    expect(flush).toEqual([]);
  });
});
