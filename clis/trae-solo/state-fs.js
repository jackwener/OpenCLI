// VSCode-style state.vscdb read commands for Trae SOLO.
//
//   storage-keys                — list all keys in globalStorage state.vscdb
//   storage-get <key>           — get a single value (auto-decode JSON)
//   recent-workspaces           — pretty-print history.recentlyOpenedPathsList
//
// All commands are READ-ONLY. Writing to state.vscdb while Trae is
// running would race with Trae's own writer and may corrupt the DB.

import * as fs from 'node:fs';
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    ArgumentError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';
import {
    TRAE_GLOBAL_STATE_DB,
    listKeys,
    getValue,
} from './_state.js';

// -------- storage-keys --------
cli({
    site: 'trae-solo',
    name: 'storage-keys',
    access: 'read',
    description: 'List all keys present in Trae SOLO\'s globalStorage state.vscdb (VSCode-style UI/agent state). Use storage-get <key> to read a specific value.',
    domain: 'localhost',
    browser: false,
    strategy: Strategy.LOCAL,
    args: [
        { name: 'filter', required: false, help: 'Case-insensitive substring filter over keys' },
        { name: 'limit', type: 'int', required: false, default: 200 },
    ],
    columns: ['Index', 'Key'],
    func: async (args) => {
        const keys = listKeys(TRAE_GLOBAL_STATE_DB);
        const flt = args.filter ? String(args.filter).toLowerCase() : null;
        const filtered = flt ? keys.filter((k) => k.toLowerCase().includes(flt)) : keys;
        if (!filtered.length) {
            throw new EmptyResultError('trae-solo storage-keys', flt ? `No keys match "${flt}".` : 'No keys.');
        }
        const limit = Number.isInteger(args.limit) && args.limit > 0 ? args.limit : 200;
        return filtered.slice(0, limit).map((k, i) => ({ Index: i + 1, Key: k }));
    },
});

// -------- storage-get --------
cli({
    site: 'trae-solo',
    name: 'storage-get',
    access: 'read',
    description: 'Read a single key from Trae SOLO\'s globalStorage state.vscdb. Returns parsed JSON if the value is JSON, otherwise the raw string.',
    domain: 'localhost',
    browser: false,
    strategy: Strategy.LOCAL,
    args: [
        { name: 'key', positional: true, required: true, help: 'Storage key (use storage-keys to discover)' },
        { name: 'max-bytes', type: 'int', required: false, default: 8000, help: 'Truncate value to this many bytes' },
    ],
    columns: ['Field', 'Value'],
    func: async (args) => {
        const key = String(args.key || '').trim();
        if (!key) throw new ArgumentError('key required');
        const val = getValue(TRAE_GLOBAL_STATE_DB, key);
        if (val === null) {
            throw new CommandExecutionError(`Key not found: ${key}`, 'List available keys with `opencli trae-solo storage-keys`.');
        }
        const max = Number.isInteger(args['max-bytes']) && args['max-bytes'] > 0 ? args['max-bytes'] : 8000;
        const valStr = typeof val === 'string' ? val : JSON.stringify(val, null, 2);
        const truncated = valStr.length > max;
        return [
            { Field: 'Key', Value: key },
            { Field: 'Type', Value: typeof val === 'string' ? 'string' : (Array.isArray(val) ? 'array' : typeof val) },
            { Field: 'Size', Value: `${valStr.length} chars${truncated ? ' (truncated)' : ''}` },
            { Field: 'Value', Value: truncated ? valStr.slice(0, max) + '\n...(truncated, use --max-bytes to read more)' : valStr },
        ];
    },
});

// -------- recent-workspaces --------
cli({
    site: 'trae-solo',
    name: 'recent-workspaces',
    access: 'read',
    description: 'Show Trae SOLO\'s recently-opened workspaces (the File → Open Recent menu, stored under key "history.recentlyOpenedPathsList" in state.vscdb).',
    domain: 'localhost',
    browser: false,
    strategy: Strategy.LOCAL,
    args: [
        { name: 'limit', type: 'int', required: false, default: 20 },
    ],
    columns: ['Index', 'Kind', 'Path'],
    func: async (args) => {
        if (!fs.existsSync(TRAE_GLOBAL_STATE_DB)) {
            throw new CommandExecutionError(`state.vscdb not found: ${TRAE_GLOBAL_STATE_DB}`, '');
        }
        const val = getValue(TRAE_GLOBAL_STATE_DB, 'history.recentlyOpenedPathsList');
        if (!val) {
            throw new EmptyResultError('trae-solo recent-workspaces', 'No recent workspaces recorded.');
        }
        const entries = val.entries || [];
        if (!entries.length) {
            throw new EmptyResultError('trae-solo recent-workspaces', 'history.recentlyOpenedPathsList has no entries.');
        }
        const limit = Number.isInteger(args.limit) && args.limit > 0 ? args.limit : 20;
        return entries.slice(0, limit).map((e, i) => {
            let kind = 'other', target = JSON.stringify(e).slice(0, 200);
            if (e.folderUri) {
                kind = 'folder';
                target = decodeURI(String(e.folderUri).replace(/^file:\/\//, ''));
            } else if (e.workspace && e.workspace.configPath) {
                kind = 'workspace';
                target = decodeURI(String(e.workspace.configPath).replace(/^file:\/\//, ''));
            } else if (e.fileUri) {
                kind = 'file';
                target = decodeURI(String(e.fileUri).replace(/^file:\/\//, ''));
            }
            return { Index: i + 1, Kind: kind, Path: target };
        });
    },
});
