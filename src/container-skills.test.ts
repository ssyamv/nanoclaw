import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(import.meta.dirname, '..');

describe('container PRD skills', () => {
  it('ships the product-requirements skill for container agents', () => {
    const skillPath = path.join(
      projectRoot,
      'container',
      'skills',
      'product-requirements',
      'SKILL.md',
    );

    expect(fs.existsSync(skillPath)).toBe(true);
  });

  it('keeps arcflow-prd-draft aligned with the product-requirements rubric', () => {
    const arcflowSkill = fs.readFileSync(
      path.join(
        projectRoot,
        'container',
        'skills',
        'arcflow-prd-draft',
        'SKILL.md',
      ),
      'utf8',
    );

    expect(arcflowSkill).toContain('product-requirements');
    expect(arcflowSkill).toContain('90');
    expect(arcflowSkill).toContain('质量评分');
  });
});
