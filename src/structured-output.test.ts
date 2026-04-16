import { describe, expect, it } from 'vitest';

import { parseStructuredOutput } from './structured-output.js';

describe('parseStructuredOutput', () => {
  it('extracts PRD markdown into an artifact and strips it from chat text', () => {
    const text = `我先给你一个 PRD 草稿。

===PRD_RESULT_START===
# 手机验证码登录

## 背景

需要支持验证码登录。
===PRD_RESULT_END===`;

    const parsed = parseStructuredOutput(text);
    expect(parsed.cleanText).toBe('我先给你一个 PRD 草稿。');
    expect(parsed.skillsLoaded).toEqual(['arcflow-prd-draft']);
    expect(parsed.artifacts).toHaveLength(1);
    expect(parsed.artifacts[0].type).toBe('prd_markdown');
    expect(parsed.artifacts[0].title).toBe('手机验证码登录');
    expect(parsed.artifacts[0].content).toContain('需要支持验证码登录');
  });

  it('returns original text when no structured marker exists', () => {
    const parsed = parseStructuredOutput('普通回复，没有结构化结果');
    expect(parsed.cleanText).toBe('普通回复，没有结构化结果');
    expect(parsed.artifacts).toEqual([]);
    expect(parsed.skillsLoaded).toEqual([]);
  });
});
