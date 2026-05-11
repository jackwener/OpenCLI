import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { findShadowedUserAdapters, formatAdapterShadowIssue } from './adapter-shadow.js';

describe('adapter shadow detection', () => {
  it('reports user adapters that shadow packaged manifest commands', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-adapter-shadow-'));
    try {
      const userClisDir = path.join(root, 'user-clis');
      const builtinRoot = path.join(root, 'pkg');
      const builtinClisDir = path.join(builtinRoot, 'clis');
      fs.mkdirSync(path.join(userClisDir, 'instagram'), { recursive: true });
      fs.mkdirSync(path.join(userClisDir, 'twitter'), { recursive: true });
      fs.mkdirSync(path.join(builtinClisDir, 'instagram'), { recursive: true });
      fs.mkdirSync(path.join(builtinClisDir, 'twitter'), { recursive: true });

      fs.writeFileSync(path.join(userClisDir, 'instagram', 'saved.js'), '', 'utf-8');
      fs.writeFileSync(path.join(userClisDir, 'instagram', 'utils.js'), '', 'utf-8');
      fs.writeFileSync(path.join(userClisDir, 'twitter', 'search.js'), '', 'utf-8');
      fs.writeFileSync(path.join(builtinClisDir, 'instagram', 'saved.js'), '', 'utf-8');
      fs.writeFileSync(path.join(builtinClisDir, 'instagram', 'utils.js'), '', 'utf-8');
      fs.writeFileSync(path.join(builtinClisDir, 'twitter', 'search.js'), '', 'utf-8');
      fs.writeFileSync(path.join(builtinRoot, 'cli-manifest.json'), `${JSON.stringify([
        { site: 'instagram', name: 'saved', sourceFile: 'instagram/saved.js' },
      ])}\n`, 'utf-8');

      expect(findShadowedUserAdapters({ userClisDir, builtinClisDir })).toEqual([
        {
          name: 'instagram/saved',
          userPath: path.join(userClisDir, 'instagram', 'saved.js'),
          builtinPath: path.join(builtinClisDir, 'instagram', 'saved.js'),
        },
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('formats a concise doctor issue', () => {
    const issue = formatAdapterShadowIssue([
      {
        name: 'instagram/saved',
        userPath: '/home/me/.opencli/clis/instagram/saved.js',
        builtinPath: '/pkg/clis/instagram/saved.js',
      },
    ]);

    expect(issue).toContain('instagram/saved');
    expect(issue).toContain('opencli adapter reset <site>');
  });
});
