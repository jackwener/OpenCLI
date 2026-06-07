import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');

describe('install-time safety', () => {
  it('does not recursively delete user adapter directories during adapter sync', () => {
    const source = fs.readFileSync(path.join(projectRoot, 'scripts', 'fetch-adapters.js'), 'utf-8');

    expect(source).not.toMatch(/rmSync\s*\([^)]*\{\s*recursive:\s*true\s*,\s*force:\s*true\s*\}/);
    expect(source).not.toMatch(/\b(?:rmSync|unlinkSync)\s*\(/);
    expect(source).not.toContain('DELETE the local override');
  });
});
