// Workspace + extension enumeration commands for Trae SOLO.
//
//   workspaces-list  — list workspaceStorage uuids + resolved folder paths
//   extensions-list  — list installed VSCode extensions from extensions.json
//
// READ-ONLY. Works while Trae SOLO is closed.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';
import {
    TRAE_WORKSPACE_STORAGE,
    TRAE_EXTENSIONS_JSON,
    resolveWorkspaceJson,
} from './_state.js';

// -------- workspaces-list --------
cli({
    site: 'trae-solo',
    name: 'workspaces-list',
    access: 'read',
    description: 'List Trae SOLO workspaceStorage entries (~/Library/.../TRAE SOLO/User/workspaceStorage/<uuid>/), resolving each workspace.json to its single-folder path or multi-folder workspace target. Works while Trae is closed.',
    domain: 'localhost',
    browser: false,
    strategy: Strategy.LOCAL,
    args: [
        { name: 'limit', type: 'int', required: false, default: 100 },
    ],
    columns: ['Index', 'Workspace Id', 'Kind', 'Target', 'Modified', 'Id', 'Version', 'Source', 'Installed'],
    func: async (args) => {
        if (!fs.existsSync(TRAE_WORKSPACE_STORAGE)) {
            throw new CommandExecutionError(
                `workspaceStorage not found: ${TRAE_WORKSPACE_STORAGE}`,
                '',
            );
        }
        const dirs = fs.readdirSync(TRAE_WORKSPACE_STORAGE).filter((n) => {
            const full = path.join(TRAE_WORKSPACE_STORAGE, n);
            return fs.statSync(full).isDirectory();
        });
        if (!dirs.length) {
            throw new EmptyResultError('trae-solo workspaces-list', 'No workspace storage entries.');
        }
        const rows = dirs.map((id) => {
            const dir = path.join(TRAE_WORKSPACE_STORAGE, id);
            const wj = path.join(dir, 'workspace.json');
            const resolved = resolveWorkspaceJson(wj);
            const mtime = fs.statSync(dir).mtimeMs;
            return { id, kind: resolved.kind, target: resolved.target, mtime };
        }).sort((a, b) => b.mtime - a.mtime);
        const limit = Number.isInteger(args.limit) && args.limit > 0 ? args.limit : 100;
        return rows.slice(0, limit).map((r, i) => ({
            Index: i + 1,
            'Workspace Id': r.id,
            Kind: r.kind,
            Target: (r.target || '').slice(0, 120),
            Modified: new Date(r.mtime).toISOString().replace('T', ' ').slice(0, 19),
            Id: '',
            Version: '',
            Source: '',
            Installed: '',
        }));
    },
});

// -------- extensions-list --------
cli({
    site: 'trae-solo',
    name: 'extensions-list',
    access: 'read',
    description: 'List VSCode extensions installed in Trae SOLO (~/.trae/extensions/extensions.json). Works while Trae is closed.',
    domain: 'localhost',
    browser: false,
    strategy: Strategy.LOCAL,
    args: [],
    columns: ['Index', 'Workspace Id', 'Kind', 'Target', 'Modified', 'Id', 'Version', 'Source', 'Installed'],
    func: async () => {
        if (!fs.existsSync(TRAE_EXTENSIONS_JSON)) {
            throw new CommandExecutionError(
                `extensions.json not found: ${TRAE_EXTENSIONS_JSON}`,
                'Trae SOLO has not installed any VSCode extensions yet.',
            );
        }
        let arr;
        try {
            arr = JSON.parse(fs.readFileSync(TRAE_EXTENSIONS_JSON, 'utf-8'));
        } catch (e) {
            throw new CommandExecutionError(`Failed to parse extensions.json: ${e.message}`, '');
        }
        if (!Array.isArray(arr) || !arr.length) {
            throw new EmptyResultError('trae-solo extensions-list', 'No extensions installed.');
        }
        return arr.map((e, i) => {
            const ts = e?.metadata?.installedTimestamp;
            const installed = ts ? new Date(ts).toISOString().replace('T', ' ').slice(0, 19) : '';
            return {
                Index: i + 1,
                'Workspace Id': '',
                Kind: '',
                Target: '',
                Modified: '',
                Id: e?.identifier?.id || '?',
                Version: e?.version || '',
                Source: e?.metadata?.source || '',
                Installed: installed,
            };
        });
    },
});
