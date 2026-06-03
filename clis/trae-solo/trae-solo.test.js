import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSkillMd } from './_fs.js';
import { resolveWorkspaceJson } from './_state.js';

describe('trae-solo filesystem helpers', () => {
    it('parses skill front matter without requiring the Trae app', () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'trae-skill-'));
        writeFileSync(path.join(dir, 'SKILL.md'), [
            '---',
            'name: Code Reviewer',
            'description: Review code changes',
            'tags: review qa',
            'version: 1.2.3',
            'author: test',
            '---',
            '',
            '# Skill',
        ].join('\n'));

        expect(parseSkillMd(dir)).toMatchObject({
            name: 'Code Reviewer',
            description: 'Review code changes',
            tags: ['review', 'qa'],
            version: '1.2.3',
            author: 'test',
        });
    });

    it('falls back to the first body paragraph when SKILL.md lacks front matter', () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'trae-skill-'));
        writeFileSync(path.join(dir, 'SKILL.md'), '# Heading\n\nFirst body paragraph.\n');

        expect(parseSkillMd(dir)).toMatchObject({
            name: path.basename(dir),
            description: 'First body paragraph.',
        });
    });

    it('resolves a folder workspace.json file URL to a local path', () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'trae-workspace-'));
        const workspaceJson = path.join(dir, 'workspace.json');
        writeFileSync(workspaceJson, JSON.stringify({ folder: 'file:///tmp/example%20project' }));

        expect(resolveWorkspaceJson(workspaceJson)).toEqual({
            kind: 'folder',
            target: '/tmp/example project',
        });
    });

    it('resolves a multi-folder workspace indirection', () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'trae-workspace-'));
        const innerDir = path.join(dir, 'inner');
        mkdirSync(innerDir);
        const inner = path.join(innerDir, 'workspace.code-workspace');
        const outer = path.join(dir, 'workspace.json');
        writeFileSync(inner, JSON.stringify({ folders: [{ path: '/repo/a' }, { uri: 'file:///repo/b' }] }));
        writeFileSync(outer, JSON.stringify({ workspace: `file://${inner}` }));

        expect(resolveWorkspaceJson(outer)).toEqual({
            kind: 'workspace',
            target: '/repo/a; file:///repo/b',
        });
    });
});
