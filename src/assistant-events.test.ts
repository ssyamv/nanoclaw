import { describe, expect, it } from 'vitest';

import { extractAssistantSnapshot } from '../container/agent-runner/src/assistant-events.ts';

describe('extractAssistantSnapshot', () => {
  it('extracts visible text and tool_use blocks from assistant content array', () => {
    const snapshot = extractAssistantSnapshot({
      message: {
        content: [
          { type: 'text', text: '先查一下。' },
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'Bash',
            input: { command: 'arcflow-api issues my' },
          },
          {
            type: 'tool_result',
            tool_use_id: 'toolu_1',
          },
          { type: 'text', text: '然后汇总。' },
        ],
      },
    });

    expect(snapshot.text).toBe('先查一下。然后汇总。');
    expect(snapshot.toolCalls).toEqual([
      {
        id: 'toolu_1',
        name: 'Bash',
        input: { command: 'arcflow-api issues my' },
      },
    ]);
    expect(snapshot.toolResults).toEqual(['toolu_1']);
  });

  it('returns empty structures for unsupported payloads', () => {
    expect(extractAssistantSnapshot({})).toEqual({
      text: '',
      toolCalls: [],
      toolResults: [],
    });
  });
});
