// File-system based skill commands — work without TRAE SOLO being focused
// or even running, because Trae stores skill state on disk under ~/.trae/.
//
// Commands:
//   skill-fs-list                — list ALL skills in ~/.trae/skills/
//   skill-fs-installed           — list installed skills (managedSkills in skill-config.json)
//   skill-fs-show <name>         — print a skill's SKILL.md
//
// Trade-off vs the UI-driven `skill-*` commands:
//   + Don't require Trae to be in foreground (works while window minimized)
//   + Read commands are instant (no CDP roundtrip)
//   + Can inspect SKILL.md content directly

import * as fs from 'node:fs';
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    ArgumentError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';
import {
    TRAE_SKILLS_DIR,
    assertReadable,
    parseSkillMd,
    readSkillConfig,
} from './_fs.js';

// -------- skill-fs-list --------
cli({
    site: 'trae-solo',
    name: 'skill-fs-list',
    access: 'read',
    description: 'List all Trae SOLO skills present on disk under ~/.trae/skills/. Reads SKILL.md front-matter for descriptions. Works while Trae is closed.',
    domain: 'localhost',
    browser: false,
    strategy: Strategy.LOCAL,
    args: [
        { name: 'limit', type: 'int', required: false, default: 200, help: 'Max rows' },
    ],
    columns: ['Index', 'Name', 'Description', 'Source'],
    func: async (args) => {
        assertReadable(TRAE_SKILLS_DIR, '~/.trae/skills');
        const dirs = fs.readdirSync(TRAE_SKILLS_DIR).filter((n) => {
            const full = path.join(TRAE_SKILLS_DIR, n);
            return fs.statSync(full).isDirectory() && !n.startsWith('_');
        });
        const rows = dirs.map((d) => parseSkillMd(path.join(TRAE_SKILLS_DIR, d)));
        const limit = Number.isInteger(args.limit) && args.limit > 0 ? args.limit : 200;
        if (!rows.length) {
            throw new EmptyResultError('trae-solo skill-fs-list', 'No skills found under ~/.trae/skills/.');
        }
        return rows.slice(0, limit).map((r, i) => ({
            Index: i + 1,
            Name: r.name,
            Description: (r.description || '').slice(0, 120),
            Source: '',
        }));
    },
});

// -------- skill-fs-installed --------
cli({
    site: 'trae-solo',
    name: 'skill-fs-installed',
    access: 'read',
    description: 'List INSTALLED Trae SOLO skills (managedSkills entry in ~/.trae/skill-config.json).',
    domain: 'localhost',
    browser: false,
    strategy: Strategy.LOCAL,
    args: [],
    columns: ['Index', 'Name', 'Description', 'Source'],
    func: async () => {
        const cfg = readSkillConfig();
        const managed = cfg.managedSkills || {};
        const rows = Object.entries(managed);
        if (!rows.length) {
            throw new EmptyResultError('trae-solo skill-fs-installed', 'No installed skills.');
        }
        return rows.map(([name, source], i) => ({
            Index: i + 1,
            Name: name,
            Description: '',
            Source: source,
        }));
    },
});

// -------- skill-fs-show --------
cli({
    site: 'trae-solo',
    name: 'skill-fs-show',
    access: 'read',
    description: 'Print a skill\'s SKILL.md content + on-disk path.',
    domain: 'localhost',
    browser: false,
    strategy: Strategy.LOCAL,
    args: [
        { name: 'name', positional: true, required: true, help: 'Skill name (folder under ~/.trae/skills/)' },
    ],
    columns: ['Field', 'Value'],
    func: async (args) => {
        const name = String(args.name || '').trim();
        if (!name) throw new ArgumentError('name required');
        const dir = path.join(TRAE_SKILLS_DIR, name);
        if (!fs.existsSync(dir)) {
            throw new CommandExecutionError(`Skill "${name}" not found.`, `Tried: ${dir}`);
        }
        const meta = parseSkillMd(dir);
        const skillMd = path.join(dir, 'SKILL.md');
        const content = fs.existsSync(skillMd) ? fs.readFileSync(skillMd, 'utf-8') : '(no SKILL.md)';
        return [
            { Field: 'Name', Value: meta.name },
            { Field: 'Path', Value: dir },
            { Field: 'Description', Value: (meta.description || '').slice(0, 200) },
            { Field: 'Tags', Value: (meta.tags || []).join(', ') },
            { Field: 'Author', Value: meta.author },
            { Field: 'Version', Value: meta.version },
            { Field: 'Files', Value: fs.readdirSync(dir).join(', ').slice(0, 200) },
            { Field: 'SKILL.md (head)', Value: content.slice(0, 1200) },
        ];
    },
});
