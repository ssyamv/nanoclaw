import { describe, expect, it } from 'vitest';

import {
  createInternalTagParserState,
  flushInternalTagParser,
  parseInternalTagDelta,
} from '../container/agent-runner/src/internal-tags.ts';

describe('internal tag parser', () => {
  it('splits visible text and thinking text into separate events', () => {
    const state = createInternalTagParserState();
    const events = parseInternalTagDelta(
      'Hello<internal>thinking</internal>world',
      state,
    );

    expect(events).toEqual([
      { type: 'message_delta', data: { text: 'Hello' } },
      { type: 'thinking_start' },
      { type: 'thinking_delta', data: { text: 'thinking' } },
      { type: 'thinking_end' },
      { type: 'message_delta', data: { text: 'world' } },
    ]);
  });

  it('handles tag boundaries split across deltas', () => {
    const state = createInternalTagParserState();
    const events1 = parseInternalTagDelta('Hello<inte', state);
    const events2 = parseInternalTagDelta('rnal>abc</inte', state);
    const events3 = parseInternalTagDelta('rnal>done', state);
    const finalEvents = flushInternalTagParser(state);

    expect(events1).toEqual([{ type: 'message_delta', data: { text: 'Hello' } }]);
    expect(events2).toEqual([
      { type: 'thinking_start' },
      { type: 'thinking_delta', data: { text: 'abc' } },
    ]);
    expect(events3).toEqual([
      { type: 'thinking_end' },
      { type: 'message_delta', data: { text: 'done' } },
    ]);
    expect(finalEvents).toEqual([]);
  });
});
