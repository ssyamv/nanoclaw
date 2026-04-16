import { describe, expect, it } from 'vitest';

import { summarizeSdkMessage } from '../container/agent-runner/src/sdk-message-debug.ts';

describe('summarizeSdkMessage', () => {
  it('summarizes assistant content blocks without dumping full payloads', () => {
    const summary = summarizeSdkMessage({
      type: 'assistant',
      uuid: 'msg-1',
      message: {
        content: [
          { type: 'text', text: 'Hello world' },
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'Bash',
          },
          {
            type: 'tool_result',
            tool_use_id: 'toolu_1',
            text: 'command output here',
          },
        ],
      },
    });

    expect(summary).toEqual({
      type: 'assistant',
      uuid: 'msg-1',
      content_parts: [
        { type: 'text', text_preview: 'Hello world' },
        { type: 'tool_use', id: 'toolu_1', name: 'Bash' },
        {
          type: 'tool_result',
          tool_use_id: 'toolu_1',
          text_preview: 'command output here',
        },
      ],
    });
  });

  it('summarizes result messages with a bounded preview', () => {
    const summary = summarizeSdkMessage({
      type: 'result',
      subtype: 'success',
      result: 'x'.repeat(200),
    });

    expect(summary.type).toBe('result');
    expect(summary.subtype).toBe('success');
    expect(summary.result_preview).toMatch(/^x+\.\.\.$/);
    expect(summary.result_preview!.length).toBeLessThan(130);
  });
});
