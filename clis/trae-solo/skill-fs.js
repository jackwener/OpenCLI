// File-system based skill commands — work without TRAE SOLO being focused
// or even running, because Trae stores skill state on disk under ~/.trae/.
//
// Commands:
//   skill-fs-list                — list ALL skills in ~/.trae/skills/
//   skill-fs-installed           — list installed skills (managedSkills in skill-config.json)
//   skill-fs-show <name>         — print a skill's SKILL.md
//   skill-fs-install <name> [--source <dir>] [--yes]
//   skill-fs-uninstall <name> [--yes]
//
// Trade-off vs the UI-driven `skill-*` commands:
//   + Don't require Trae to be in foreground (works while window minimized)
//   + Read commands are instant (no CDP roundtrip)
//   + Can inspect SKILL.md content directly
//   - Write commands need Trae to reload its skill registry (restart, or
//     wait for its own file-watcher to pick up changes)

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
    TRAE_SKILL_CONFIG,
    assertReadable,
    parseSkillMd,
    readSkillConfig,
    updateSkillConfig,
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
    columns: ['Index', 'Name', 'Description'],
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
    columns: ['Index', 'Name', 'Source'],
    func: async () => {
        const cfg = readSkillConfig();
        const managed = cfg.managedSkills || {};
        const rows = Object.entries(managed);
        if (!rows.length) {
            throw new EmptyResultError('trae-solo skill-fs-installed', 'No installed skills.');
        }
        return rows.map(([name, source], i) => ({ Index: i + 1, Name: name, Source: source }));
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

// -------- skill-fs-install --------
cli({
    site: 'trae-solo',
    name: 'skill-fs-install',
    access: 'write',
    description: 'Install (register) a skill into Trae SOLO\'s ~/.trae/skill-config.json. With --source <dir>, the skill directory is copied to ~/.trae/skills/<name>/ first. NOTE: Trae must be reloaded for changes to take effect (Cmd+Q + reopen, or rely on its file-watcher).',
    domain: 'localhost',
    browser: false,
    strategy: Strategy.LOCAL,
    args: [
        { name: 'name', positional: true, required: true, help: 'Skill name to register' },
        { name: 'source', required: false, help: 'Source dir to copy into ~/.trae/skills/<name>/ before registering. Optional if skill dir already exists.' },
        { name: 'source-tag', required: false, default: 'marketplace', help: 'Skill source tag written to skill-config.json (e.g. "marketplace", "user")' },
        { name: 'yes', type: 'boolean', default: false, help: 'Actually install (default is dry-run)' },
    ],
    columns: ['Status', 'Name', 'Source'],
    func: async (args) => {
        const name = String(args.name || '').trim();
        if (!name) throw new ArgumentError('name required');
        const source = String(args.source || '').trim();
        const sourceTag = String(args['source-tag'] || args.sourceTag || 'marketplace').trim();
        const yes = args.yes === true || args.yes === 'true' || args.yes === '1';

        const skillDir = path.join(TRAE_SKILLS_DIR, name);
        const cfg = readSkillConfig();
        const alreadyManaged = (cfg.managedSkills || {})[name];
        const dirExists = fs.existsSync(skillDir);

        if (!yes) {
            const plan = [];
            if (source && !dirExists) plan.push(`copy "${source}" → ${skillDir}`);
            if (!alreadyManaged) plan.push(`add "${name}": "${sourceTag}" to skill-config.json`);
            if (!plan.length) plan.push('(no-op; skill already installed)');
            return [{
                Status: 'dry-run (pass --yes to install)',
                Name: name,
                Source: plan.join('; '),
            }];
        }

        // Copy source dir if requested + not already there.
        if (source && !dirExists) {
            if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
                throw new CommandExecutionError(`Source dir not found or not a directory: ${source}`, '');
            }
            copyDirRecursive(source, skillDir);
        }
        if (!fs.existsSync(skillDir)) {
            throw new CommandExecutionError(
                `Skill dir not present at ${skillDir} and no --source provided.`,
                'Run again with --source <path-to-skill-dir>.',
            );
        }

        updateSkillConfig((c) => {
            if (!c.managedSkills) c.managedSkills = {};
            c.managedSkills[name] = sourceTag;
        });
        return [{
            Status: 'installed (restart Trae SOLO to load)',
            Name: name,
            Source: sourceTag,
        }];
    },
});

// -------- skill-fs-uninstall --------
cli({
    site: 'trae-solo',
    name: 'skill-fs-uninstall',
    access: 'write',
    description: 'Unregister a skill from skill-config.json. With --purge, also rm -rf its ~/.trae/skills/<name>/ directory. NOTE: Trae must be reloaded for changes to take effect.',
    domain: 'localhost',
    browser: false,
    strategy: Strategy.LOCAL,
    args: [
        { name: 'name', positional: true, required: true, help: 'Skill name to unregister' },
        { name: 'purge', type: 'boolean', default: false, help: 'Also remove the skill directory from disk' },
        { name: 'yes', type: 'boolean', default: false, help: 'Actually uninstall (default is dry-run)' },
    ],
    columns: ['Status', 'Name', 'Action'],
    func: async (args) => {
        const name = String(args.name || '').trim();
        if (!name) throw new ArgumentError('name required');
        const purge = args.purge === true || args.purge === 'true';
        const yes = args.yes === true || args.yes === 'true' || args.yes === '1';

        const skillDir = path.join(TRAE_SKILLS_DIR, name);
        const cfg = readSkillConfig();
        const wasManaged = !!(cfg.managedSkills || {})[name];

        if (!yes) {
            const plan = [];
            if (wasManaged) plan.push(`remove "${name}" from skill-config.json managedSkills`);
            if (purge && fs.existsSync(skillDir)) plan.push(`rm -rf ${skillDir}`);
            if (!plan.length) plan.push('(no-op; nothing to remove)');
            return [{
                Status: 'dry-run (pass --yes to uninstall)',
                Name: name,
                Action: plan.join('; '),
            }];
        }

        updateSkillConfig((c) => {
            if (c.managedSkills) delete c.managedSkills[name];
        });
        if (purge && fs.existsSync(skillDir)) {
            fs.rmSync(skillDir, { recursive: true, force: true });
        }
        return [{
            Status: 'uninstalled (restart Trae SOLO to apply)',
            Name: name,
            Action: purge ? 'unregistered + dir removed' : 'unregistered',
        }];
    },
});

// Simple recursive copy (avoids depending on fs.cp's stable Node version).
function copyDirRecursive(src, dst) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dst, entry.name);
        if (entry.isDirectory()) {
            copyDirRecursive(s, d);
        } else if (entry.isSymbolicLink()) {
            fs.symlinkSync(fs.readlinkSync(s), d);
        } else {
            fs.copyFileSync(s, d);
        }
    }
}
