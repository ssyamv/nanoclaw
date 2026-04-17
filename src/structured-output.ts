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
const ARCFLOW_ARTIFACT_START = '===ARCFLOW_ARTIFACT_START===';
const ARCFLOW_ARTIFACT_END = '===ARCFLOW_ARTIFACT_END===';

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

function joinCleanText(before: string, after: string): string {
  const left = before.trimEnd();
  const right = after.trimStart();
  if (left && right) return `${left}\n\n${right}`;
  return `${left}${right}`;
}

function pushUniqueSkill(skillsLoaded: string[], name: string): void {
  if (!skillsLoaded.includes(name)) skillsLoaded.push(name);
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
    pushUniqueSkill(skillsLoaded, 'arcflow-prd-draft');
    cleanText = joinCleanText(prd.before, prd.after).trim();
  }

  while (true) {
    const block = extractBetween(
      cleanText,
      ARCFLOW_ARTIFACT_START,
      ARCFLOW_ARTIFACT_END,
    );
    if (!block) break;

    try {
      const artifact = JSON.parse(block.body.trim()) as StructuredArtifact;
      if (
        typeof artifact.id === 'string' &&
        typeof artifact.type === 'string' &&
        typeof artifact.title === 'string' &&
        typeof artifact.content === 'string'
      ) {
        artifacts.push(artifact);
        pushUniqueSkill(skillsLoaded, 'arcflow-api');
        cleanText = joinCleanText(block.before, block.after).trim();
        continue;
      }
    } catch {
      // Keep the raw block in the visible text if the payload is malformed.
    }

    break;
  }

  return {
    cleanText,
    artifacts,
    skillsLoaded,
  };
}
