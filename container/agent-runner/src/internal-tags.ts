export interface InternalTagState {
  carry: string;
  inInternal: boolean;
}

export interface ParsedInternalEvent {
  type:
    | 'message_delta'
    | 'thinking_start'
    | 'thinking_delta'
    | 'thinking_end';
  text?: string;
}

const START_TAG = '<internal>';
const END_TAG = '</internal>';

function longestMarkerPrefixSuffix(input: string, marker: string): number {
  const max = Math.min(input.length, marker.length - 1);
  for (let len = max; len > 0; len--) {
    if (input.slice(-len) === marker.slice(0, len)) return len;
  }
  return 0;
}

export function createInternalTagState(): InternalTagState {
  return { carry: '', inInternal: false };
}

export const createInternalTagParserState = createInternalTagState;

export function parseInternalTaggedDelta(
  delta: string,
  state: InternalTagState,
): ParsedInternalEvent[] {
  let input = state.carry + delta;
  state.carry = '';
  const events: ParsedInternalEvent[] = [];

  while (input.length > 0) {
    if (state.inInternal) {
      const endIdx = input.indexOf(END_TAG);
      if (endIdx === -1) {
        const keep = longestMarkerPrefixSuffix(input, END_TAG);
        const chunk = input.slice(0, input.length - keep);
        if (chunk) events.push({ type: 'thinking_delta', text: chunk });
        state.carry = input.slice(input.length - keep);
        break;
      }

      const chunk = input.slice(0, endIdx);
      if (chunk) events.push({ type: 'thinking_delta', text: chunk });
      events.push({ type: 'thinking_end' });
      state.inInternal = false;
      input = input.slice(endIdx + END_TAG.length);
      continue;
    }

    const startIdx = input.indexOf(START_TAG);
    if (startIdx === -1) {
      const keep = longestMarkerPrefixSuffix(input, START_TAG);
      const chunk = input.slice(0, input.length - keep);
      if (chunk) events.push({ type: 'message_delta', text: chunk });
      state.carry = input.slice(input.length - keep);
      break;
    }

    const chunk = input.slice(0, startIdx);
    if (chunk) events.push({ type: 'message_delta', text: chunk });
    events.push({ type: 'thinking_start' });
    state.inInternal = true;
    input = input.slice(startIdx + START_TAG.length);
  }

  return events;
}

export const parseInternalTagDelta = parseInternalTaggedDelta;

export function flushInternalTagState(
  state: InternalTagState,
): ParsedInternalEvent[] {
  if (!state.carry) return [];

  const events: ParsedInternalEvent[] = [];
  if (state.inInternal) {
    events.push({ type: 'thinking_delta', text: state.carry });
    events.push({ type: 'thinking_end' });
  } else {
    events.push({ type: 'message_delta', text: state.carry });
  }

  state.carry = '';
  state.inInternal = false;
  return events;
}

export const flushInternalTagParser = flushInternalTagState;
