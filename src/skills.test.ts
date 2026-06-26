import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ArgumentError } from './errors.js';
import { listOpenCliSkills, readOpenCliSkill } from './skills.js';

function makePackageRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-skills-'));
  fs.mkdirSync(path.join(root, 'skills', 'opencli-browser', 'references'), { recursive: true });
  fs.mkdirSync(path.join(root, 'skills', 'opencli-autofix'), { recursive: true });
  fs.mkdirSync(path.join(root, 'skills', 'smart-search'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"@jackwener/opencli"}\n');
  fs.writeFileSync(path.join(root, 'skills', 'opencli-browser', 'SKILL.md'), [
    '---',
    'name: opencli-browser',
    'description: Browser control skill',
    'version: 1.2.3',
    '---',
    '',
    '# Browser',
    '',
    'Body.',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'skills', 'opencli-browser', 'references', 'targets.md'), '# Targets\n');
  fs.writeFileSync(path.join(root, 'skills', 'opencli-autofix', 'SKILL.md'), [
    '---',
    'name: opencli-autofix',
    'description: Fix adapters: keep scope narrow',
    '---',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'skills', 'smart-search', 'SKILL.md'), [
    '---',
    'name: smart-search',
    'description: Search skill',
    '---',
    '',
  ].join('\n'));
  return root;
}

describe('opencli skills content', () => {
  it('lists only opencli-prefixed skills', () => {
    const root = makePackageRoot();

    expect(listOpenCliSkills(root).map((skill) => skill.name)).toEqual([
      'opencli-autofix',
      'opencli-browser',
    ]);
    expect(listOpenCliSkills(root).find((skill) => skill.name === 'opencli-autofix')?.description)
      .toBe('Fix adapters: keep scope narrow');
  });

  it('reads a skill SKILL.md and reference file', () => {
    const root = makePackageRoot();

    expect(readOpenCliSkill('opencli-browser', '', root)).toMatchObject({
      skill: 'opencli-browser',
      path: 'SKILL.md',
    });
    expect(readOpenCliSkill('opencli-browser/references/targets.md', '', root)).toMatchObject({
      skill: 'opencli-browser',
      path: 'references/targets.md',
      content: '# Targets\n',
    });
    expect(readOpenCliSkill('opencli-browser', 'references/targets.md', root).content).toBe('# Targets\n');
  });

  it('rejects non-opencli skills and path traversal', () => {
    const root = makePackageRoot();

    expect(() => readOpenCliSkill('smart-search', '', root)).toThrow(ArgumentError);
    expect(() => readOpenCliSkill('opencli-browser/../smart-search/SKILL.md', '', root)).toThrow(ArgumentError);
    expect(() => readOpenCliSkill('opencli-browser', '../../package.json', root)).toThrow(ArgumentError);
  });
});
