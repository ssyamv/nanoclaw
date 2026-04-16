interface ContentPartSummary {
  type: string;
  id?: string;
  name?: string;
  tool_use_id?: string;
  text_preview?: string;
}

export interface SdkMessageSummary {
  type: string;
  subtype?: string;
  session_id?: string;
  uuid?: string;
  content_parts?: ContentPartSummary[];
  result_preview?: string;
}

function previewText(input: unknown, limit = 80): string | undefined {
  if (typeof input !== 'string') return undefined;
  const normalized = input.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  return normalized.length > limit
    ? `${normalized.slice(0, limit)}...`
    : normalized;
}

export function summarizeSdkMessage(message: unknown): SdkMessageSummary {
  const m = message as {
    type?: string;
    subtype?: string;
    session_id?: string;
    uuid?: string;
    result?: string;
    message?: {
      content?: Array<{
        type?: string;
        id?: string;
        name?: string;
        tool_use_id?: string;
        text?: string;
      }> | string;
    };
  };

  const summary: SdkMessageSummary = {
    type: m.type ?? 'unknown',
  };
  if (typeof m.subtype === 'string') summary.subtype = m.subtype;
  if (typeof m.session_id === 'string') summary.session_id = m.session_id;
  if (typeof m.uuid === 'string') summary.uuid = m.uuid;
  if (typeof m.result === 'string') {
    summary.result_preview = previewText(m.result, 120);
  }

  const content = m.message?.content;
  if (Array.isArray(content)) {
    summary.content_parts = content.map((part) => ({
      type: part?.type ?? 'unknown',
      ...(typeof part?.id === 'string' ? { id: part.id } : {}),
      ...(typeof part?.name === 'string' ? { name: part.name } : {}),
      ...(typeof part?.tool_use_id === 'string'
        ? { tool_use_id: part.tool_use_id }
        : {}),
      ...(previewText(part?.text) ? { text_preview: previewText(part?.text)! } : {}),
    }));
  } else if (typeof content === 'string') {
    summary.content_parts = [
      {
        type: 'string',
        ...(previewText(content) ? { text_preview: previewText(content)! } : {}),
      },
    ];
  }

  return summary;
}
