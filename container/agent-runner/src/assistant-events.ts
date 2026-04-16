export interface AssistantToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface AssistantSnapshot {
  text: string;
  toolCalls: AssistantToolCall[];
  toolResults: string[];
}

interface AssistantContentPart {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
}

export function extractAssistantSnapshot(message: unknown): AssistantSnapshot {
  const assistant = message as {
    message?: {
      content?: string | AssistantContentPart[];
    };
  };

  const content = assistant.message?.content;
  if (typeof content === 'string') {
    return { text: content, toolCalls: [], toolResults: [] };
  }
  if (!Array.isArray(content)) {
    return { text: '', toolCalls: [], toolResults: [] };
  }

  const text = content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text ?? '')
    .join('');

  const toolCalls = content
    .filter(
      (part) =>
        part?.type === 'tool_use' &&
        typeof part.id === 'string' &&
        typeof part.name === 'string',
    )
    .map((part) => ({
      id: part.id!,
      name: part.name!,
      input: part.input,
    }));

  const toolResults = content
    .filter(
      (part) =>
        part?.type === 'tool_result' && typeof part.tool_use_id === 'string',
    )
    .map((part) => part.tool_use_id!);

  return { text, toolCalls, toolResults };
}
