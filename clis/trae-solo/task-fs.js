// File-system based task commands. Each TRAE SOLO conversation is stored
// as:
//   1. snapshot/<task-uuid>/v2/.git  — a real git repo with chat-turn refs
//      (tag pattern: before-chat-turn-<turn-uuid> / after-chat-turn-<turn-uuid>)
//   2. agentconfig/<task-uuid>.json + <task-uuid>-hooks.json  — per-task config
//   3. work-mode-projects/<project-uuid>/...  — workspace files
//
// Commands:
//   task-fs-list                       — list snapshot/<uuid> dirs + agentconfig presence
//   task-fs-turns <task-id>            — git log on the snapshot repo (chat-turn timeline)
//   task-fs-show <task-id> [--turn N]  — extract a turn snapshot via git show

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    ArgumentError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';
import {
    TRAE_SNAPSHOT_DIR,
    TRAE_AGENTCONFIG_DIR,
    assertReadable,
} from './_fs.js';

function snapshotRepoFor(taskId) {
    return path.join(TRAE_SNAPSHOT_DIR, taskId, 'v2');
}

function gitInRepo(repoPath, args) {
    return execFileSync('git', args, { cwd: repoPath, encoding: 'utf-8' }).trim();
}

// -------- task-fs-list --------
cli({
    site: 'trae-solo',
    name: 'task-fs-list',
    access: 'read',
    description: 'List Trae SOLO task ids from disk (snapshot/<uuid> + agentconfig/<uuid>.json). Works while Trae is closed.',
    domain: 'localhost',
    browser: false,
    strategy: Strategy.LOCAL,
    args: [
        { name: 'limit', type: 'int', required: false, default: 100 },
    ],
    columns: ['Index', 'Task Id', 'Has Snapshot', 'Has Config', 'Modified', 'Phase', 'Turn Id', 'Commit'],
    func: async (args) => {
        assertReadable(TRAE_SNAPSHOT_DIR, 'ai-agent/snapshot');
        const snapshotIds = new Set(
            fs.readdirSync(TRAE_SNAPSHOT_DIR).filter((n) => fs.statSync(path.join(TRAE_SNAPSHOT_DIR, n)).isDirectory()),
        );
        const configIds = fs.existsSync(TRAE_AGENTCONFIG_DIR)
            ? new Set(fs.readdirSync(TRAE_AGENTCONFIG_DIR)
                .filter((n) => n.endsWith('.json') && !n.endsWith('-hooks.json') && !n.startsWith('boot') && !n.startsWith('ide_'))
                .map((n) => n.replace(/\.json$/, '')))
            : new Set();
        const all = [...new Set([...snapshotIds, ...configIds])];
        const rows = all
            .map((id) => {
                const snapPath = path.join(TRAE_SNAPSHOT_DIR, id);
                const configPath = path.join(TRAE_AGENTCONFIG_DIR, id + '.json');
                const hasSnap = fs.existsSync(snapPath);
                const hasCfg = fs.existsSync(configPath);
                let mtime = 0;
                if (hasSnap) mtime = Math.max(mtime, fs.statSync(snapPath).mtimeMs);
                if (hasCfg) mtime = Math.max(mtime, fs.statSync(configPath).mtimeMs);
                return { id, hasSnap, hasCfg, mtime };
            })
            .sort((a, b) => b.mtime - a.mtime);
        const limit = Number.isInteger(args.limit) && args.limit > 0 ? args.limit : 100;
        if (!rows.length) {
            throw new EmptyResultError('trae-solo task-fs-list', 'No tasks on disk.');
        }
        return rows.slice(0, limit).map((r, i) => ({
            Index: i + 1,
            'Task Id': r.id,
            'Has Snapshot': r.hasSnap ? 'yes' : 'no',
            'Has Config': r.hasCfg ? 'yes' : 'no',
            Modified: new Date(r.mtime).toISOString().replace('T', ' ').slice(0, 19),
            Phase: '',
            'Turn Id': '',
            Commit: '',
        }));
    },
});

// -------- task-fs-turns --------
cli({
    site: 'trae-solo',
    name: 'task-fs-turns',
    access: 'read',
    description: 'Show the chat-turn timeline for a Trae SOLO task as git tags (before-chat-turn-* / after-chat-turn-*).',
    domain: 'localhost',
    browser: false,
    strategy: Strategy.LOCAL,
    args: [
        { name: 'task-id', positional: true, required: true, help: 'Task UUID (folder name under snapshot/)' },
        { name: 'limit', type: 'int', required: false, default: 50 },
    ],
    columns: ['Index', 'Task Id', 'Has Snapshot', 'Has Config', 'Modified', 'Phase', 'Turn Id', 'Commit'],
    func: async (args) => {
        const tid = String(args['task-id'] || '').trim();
        if (!tid) throw new ArgumentError('task-id required');
        const repo = snapshotRepoFor(tid);
        if (!fs.existsSync(path.join(repo, '.git'))) {
            throw new CommandExecutionError(`No snapshot repo for task ${tid}.`, `Tried: ${repo}`);
        }
        // List tags + their commits, sort by commit date.
        const raw = gitInRepo(repo, ['for-each-ref', '--format=%(refname:short)|%(*objectname:short)|%(objectname:short)|%(committerdate:iso8601)', 'refs/tags']);
        const rows = raw.split('\n').filter(Boolean).map((line) => {
            const [tag, _ptr, oid, date] = line.split('|');
            const m = tag.match(/^(before|after)-chat-turn-([0-9a-f]+)(?:-(refresh))?$/);
            const phase = m ? (m[1] + (m[3] ? '/refresh' : '')) : 'misc';
            const turnId = m ? m[2] : tag;
            return { phase, turnId, oid, date };
        }).sort((a, b) => a.date.localeCompare(b.date));
        if (!rows.length) {
            throw new EmptyResultError('trae-solo task-fs-turns', `No chat-turn refs in ${repo}.`);
        }
        const limit = Number.isInteger(args.limit) && args.limit > 0 ? args.limit : 50;
        return rows.slice(0, limit).map((r, i) => ({
            Index: i + 1,
            'Task Id': '',
            'Has Snapshot': '',
            'Has Config': '',
            Modified: '',
            Phase: r.phase,
            'Turn Id': r.turnId,
            Commit: r.oid,
        }));
    },
});

// -------- task-fs-show --------
cli({
    site: 'trae-solo',
    name: 'task-fs-show',
    access: 'read',
    description: 'Show the workspace tree at a given chat-turn ref (via git ls-tree). Pass --turn <turn-id> to pick a turn; otherwise the latest after-chat-turn ref.',
    domain: 'localhost',
    browser: false,
    strategy: Strategy.LOCAL,
    args: [
        { name: 'task-id', positional: true, required: true, help: 'Task UUID' },
        { name: 'turn', required: false, help: 'Specific turn id (omit for latest after-chat-turn)' },
        { name: 'limit', type: 'int', required: false, default: 50 },
    ],
    columns: ['Mode', 'Path', 'Size'],
    func: async (args) => {
        const tid = String(args['task-id'] || '').trim();
        if (!tid) throw new ArgumentError('task-id required');
        const repo = snapshotRepoFor(tid);
        if (!fs.existsSync(path.join(repo, '.git'))) {
            throw new CommandExecutionError(`No snapshot repo for task ${tid}.`, `Tried: ${repo}`);
        }
        let ref;
        if (args.turn) {
            const t = String(args.turn).trim();
            // Prefer after-* if present; else before-*.
            const tagListRaw = gitInRepo(repo, ['for-each-ref', '--format=%(refname:short)', 'refs/tags']);
            const tags = tagListRaw.split('\n').filter((x) => x.includes(t));
            ref = tags.find((x) => x.startsWith('after-chat-turn-')) || tags[0];
            if (!ref) throw new CommandExecutionError(`No tag matched turn "${t}".`, '');
        } else {
            // Pick the latest after-chat-turn ref.
            const raw = gitInRepo(repo, ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/tags']);
            ref = raw.split('\n').find((t) => t.startsWith('after-chat-turn-'));
            if (!ref) throw new CommandExecutionError('No after-chat-turn tags found.', '');
        }
        const tree = gitInRepo(repo, ['ls-tree', '-r', '-l', ref]);
        const rows = tree.split('\n').filter(Boolean).map((line) => {
            const parts = line.split(/\s+/);
            // mode  type  oid  size  path
            return { mode: parts[0], oid: parts[2], size: parts[3], pth: parts.slice(4).join(' ') };
        });
        const limit = Number.isInteger(args.limit) && args.limit > 0 ? args.limit : 50;
        return rows.slice(0, limit).map((r) => ({ Mode: r.mode, Path: r.pth, Size: r.size }));
    },
});
