export interface StructuredArtifact {
  id: string;
  type: string;
  title: string;
  content: string;
}

export interface StructuredOutput {
  cleanText: string;
  artifacts: StructuredArtifact[];
  skillsLoaded: string[];
}

const PRD_MARKER_START = '===PRD_RESULT_START===';
const PRD_MARKER_END = '===PRD_RESULT_END===';

function extractBetween(
  text: string,
  startMarker: string,
  endMarker: string,
): { before: string; body: string; after: string } | null {
  const start = text.indexOf(startMarker);
  if (start === -1) return null;
  const end = text.indexOf(endMarker, start + startMarker.length);
  if (end === -1) return null;
  return {
    before: text.slice(0, start),
    body: text.slice(start + startMarker.length, end),
    after: text.slice(end + endMarker.length),
  };
}

function titleFromMarkdown(markdown: string): string {
  const heading = markdown.match(/^\s*#\s+(.+)$/m);
  if (heading?.[1]) return heading[1].trim();
  return 'PRD 草稿';
}

export function parseStructuredOutput(text: string): StructuredOutput {
  const artifacts: StructuredArtifact[] = [];
  const skillsLoaded: string[] = [];
  let cleanText = text;

  const prd = extractBetween(cleanText, PRD_MARKER_START, PRD_MARKER_END);
  if (prd) {
    const markdown = prd.body.trim();
    artifacts.push({
      id: `prd-${Date.now()}`,
      type: 'prd_markdown',
      title: titleFromMarkdown(markdown),
      content: markdown,
    });
    skillsLoaded.push('arcflow-prd-draft');
    cleanText = `${prd.before}${prd.after}`.trim();
  }

  return {
    cleanText,
    artifacts,
    skillsLoaded,
  };
}
