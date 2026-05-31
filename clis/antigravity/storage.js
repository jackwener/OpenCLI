// Storage commands for Antigravity:
//   Renderer-side (4): storage-keys / storage-get / cookies / idb-list
//   VSCode FS-side (4): state-keys / state-get / recent-paths / workspaces-list
//   Settings (1):       settings-read

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    ArgumentError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';
import { unwrapEvaluateResult } from './_actions.js';

const STORAGE_COLUMNS = [
    'Index',
    'Key',
    'Bytes',
    'Name',
    'Preview',
    'Database',
    'Version',
    'Kind',
    'Path',
    'Workspace Id',
    'Folder',
    'Modified',
    'Field',
    'Value',
];

// ====== Path helpers ======
const AG_APP_SUPPORT = path.join(os.homedir(), 'Library/Application Support/Antigravity');
const AG_USER_DIR = path.join(AG_APP_SUPPORT, 'User');
const AG_GLOBAL_STATE_DB = path.join(AG_USER_DIR, 'globalStorage/state.vscdb');
const AG_WORKSPACE_STORAGE = path.join(AG_USER_DIR, 'workspaceStorage');
const AG_SETTINGS_JSON = path.join(AG_USER_DIR, 'settings.json');

function sqliteQuery(db, sql) {
    if (!fs.existsSync(db)) {
        throw new CommandExecutionError(`state.vscdb not found: ${db}`, 'Has Antigravity been run at least once?');
    }
    try {
        return execFileSync('/usr/bin/sqlite3', [db, sql], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
    } catch (e) {
        throw new CommandExecutionError(
            `sqlite3 failed on ${path.basename(db)}: ${e.message}`,
            'The DB may be locked by a running Antigravity instance. Try closing it or wait a few seconds.',
        );
    }
}
function listKeys(db) {
    const out = sqliteQuery(db, 'SELECT key FROM ItemTable ORDER BY key;');
    return out.split('\n').map((s) => s.trim()).filter(Boolean);
}
function getValue(db, key) {
    const esc = key.replace(/'/g, "''");
    const raw = sqliteQuery(db, `SELECT value FROM ItemTable WHERE key = '${esc}';`).trim();
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return raw; }
}
function resolveStateDb(args) {
    const ws = args?.workspace ? String(args.workspace).trim() : '';
    if (!ws) return AG_GLOBAL_STATE_DB;
    const db = path.join(AG_WORKSPACE_STORAGE, ws, 'state.vscdb');
    if (!fs.existsSync(db)) {
        throw new CommandExecutionError(`Workspace state.vscdb not found: ${db}`, 'List workspace ids with `opencli antigravity workspaces-list`.');
    }
    return db;
}

// ====== Renderer-side: storage-keys ======
cli({
    site: 'antigravity',
    name: 'storage-keys',
    access: 'read',
    description: 'List localStorage / sessionStorage keys on the Antigravity renderer (CDP).',
    domain: '127.0.0.1',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'storage', required: false, default: 'local', help: '"local" or "session"' },
        { name: 'filter', required: false, help: 'Case-insensitive substring filter' },
        { name: 'limit', type: 'int', required: false, default: 100, help: 'Max rows to return' },
    ],
    columns: STORAGE_COLUMNS,
    func: async (page, kwargs) => {
        const s = String(kwargs?.storage || 'local').trim().toLowerCase();
        if (s !== 'local' && s !== 'session') throw new ArgumentError('storage', 'must be "local" or "session"');
        const store = s === 'session' ? 'sessionStorage' : 'localStorage';
        const raw = unwrapEvaluateResult(await page.evaluate(`(() => {
      const s = ${store};
      const out = [];
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i); const v = s.getItem(k) || '';
        out.push({ k, bytes: v.length });
      }
      return out;
    })()`));
        const flt = kwargs?.filter ? String(kwargs.filter).toLowerCase() : null;
        const filtered = flt ? raw.filter((r) => r.k.toLowerCase().includes(flt)) : raw;
        if (!filtered.length) throw new EmptyResultError('antigravity storage-keys', flt ? `No keys match "${flt}".` : `${store} is empty.`);
        filtered.sort((a, b) => a.k.localeCompare(b.k));
        const limit = Number.isInteger(kwargs?.limit) && kwargs.limit > 0 ? kwargs.limit : 100;
        return filtered.slice(0, limit).map((r, i) => ({ Index: i + 1, Key: r.k, Bytes: r.bytes }));
    },
});

// ====== Renderer-side: storage-get ======
cli({
    site: 'antigravity',
    name: 'storage-get',
    access: 'read',
    description: 'Read a single localStorage / sessionStorage value on the Antigravity renderer.',
    domain: '127.0.0.1',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'key', positional: true, required: true, help: 'Storage key name' },
        { name: 'storage', required: false, default: 'local', help: '"local" or "session"' },
        { name: 'max-bytes', type: 'int', required: false, default: 4000, help: 'Truncate value to this many chars' },
    ],
    columns: STORAGE_COLUMNS,
    func: async (page, kwargs) => {
        const key = String(kwargs?.key || '').trim();
        if (!key) throw new ArgumentError('key', 'is required');
        const s = String(kwargs?.storage || 'local').trim().toLowerCase();
        const store = s === 'session' ? 'sessionStorage' : 'localStorage';
        const raw = unwrapEvaluateResult(await page.evaluate(`${store}.getItem(${JSON.stringify(key)})`));
        if (raw === null) throw new CommandExecutionError(`Key not found in ${store}: ${key}`, '');
        const max = Number.isInteger(kwargs['max-bytes']) && kwargs['max-bytes'] > 0 ? kwargs['max-bytes'] : 4000;
        let parsed = raw, kind = 'string';
        try { parsed = JSON.parse(raw); kind = Array.isArray(parsed) ? 'array' : typeof parsed; } catch {}
        const text = kind === 'string' ? parsed : JSON.stringify(parsed, null, 2);
        const truncated = text.length > max;
        return [
            { Field: 'Key', Value: key },
            { Field: 'Store', Value: store },
            { Field: 'Type', Value: kind },
            { Field: 'Size', Value: `${text.length} chars${truncated ? ' (truncated)' : ''}` },
            { Field: 'Value', Value: truncated ? text.slice(0, max) + '\n...(truncated)' : text },
        ];
    },
});

// ====== Renderer-side: cookies ======
cli({
    site: 'antigravity',
    name: 'cookies',
    access: 'read',
    description: 'List cookies on the Antigravity renderer (JS-visible via document.cookie).',
    domain: '127.0.0.1',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: STORAGE_COLUMNS,
    func: async (page) => {
        const raw = unwrapEvaluateResult(await page.evaluate('document.cookie'));
        if (!raw) throw new EmptyResultError('antigravity cookies', 'document.cookie is empty.');
        const cookies = raw.split('; ').map((pair) => {
            const idx = pair.indexOf('=');
            if (idx < 0) return { name: pair, value: '' };
            return { name: pair.slice(0, idx), value: pair.slice(idx + 1) };
        });
        return cookies.map((c, i) => ({
            Index: i + 1, Name: c.name, Bytes: c.value.length,
            Preview: c.value.slice(0, 40) + (c.value.length > 40 ? '…' : ''),
        }));
    },
});

// ====== Renderer-side: idb-list ======
cli({
    site: 'antigravity',
    name: 'idb-list',
    access: 'read',
    description: 'List IndexedDB databases on the Antigravity renderer.',
    domain: '127.0.0.1',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: STORAGE_COLUMNS,
    func: async (page) => {
        const dbs = unwrapEvaluateResult(await page.evaluate(`(async () => indexedDB.databases ? await indexedDB.databases() : [])()`));
        if (!Array.isArray(dbs) || !dbs.length) throw new EmptyResultError('antigravity idb-list', 'No IndexedDB databases.');
        return dbs.map((d, i) => ({ Index: i + 1, Database: d.name || '(unnamed)', Version: String(d.version || '') }));
    },
});

// ====== FS-side: state-keys ======
cli({
    site: 'antigravity',
    name: 'state-keys',
    access: 'read',
    description: 'List keys in Antigravity\'s globalStorage state.vscdb (VSCode-style). Pass --workspace <id> to query a per-workspace DB. Works while Antigravity is closed.',
    domain: 'localhost',
    strategy: Strategy.LOCAL,
    browser: false,
    args: [
        { name: 'filter', required: false, help: 'Case-insensitive substring filter over keys' },
        { name: 'workspace', required: false, help: 'Workspace id (from workspaces-list) to query per-workspace DB' },
        { name: 'limit', type: 'int', required: false, default: 200, help: 'Max rows to return' },
    ],
    columns: STORAGE_COLUMNS,
    func: async (args) => {
        const db = resolveStateDb(args);
        const keys = listKeys(db);
        const flt = args?.filter ? String(args.filter).toLowerCase() : null;
        const filtered = flt ? keys.filter((k) => k.toLowerCase().includes(flt)) : keys;
        if (!filtered.length) throw new EmptyResultError('antigravity state-keys', flt ? `No keys match "${flt}".` : 'No keys.');
        const limit = Number.isInteger(args?.limit) && args.limit > 0 ? args.limit : 200;
        return filtered.slice(0, limit).map((k, i) => ({ Index: i + 1, Key: k }));
    },
});

// ====== FS-side: state-get ======
cli({
    site: 'antigravity',
    name: 'state-get',
    access: 'read',
    description: 'Read one value from Antigravity\'s state.vscdb. Pass --workspace <id> for per-workspace.',
    domain: 'localhost',
    strategy: Strategy.LOCAL,
    browser: false,
    args: [
        { name: 'key', positional: true, required: true, help: 'Storage key name' },
        { name: 'workspace', required: false, help: 'Workspace id (from workspaces-list) to query per-workspace DB' },
        { name: 'max-bytes', type: 'int', required: false, default: 8000, help: 'Truncate value to this many chars' },
    ],
    columns: STORAGE_COLUMNS,
    func: async (args) => {
        const key = String(args?.key || '').trim();
        if (!key) throw new ArgumentError('key', 'is required');
        const db = resolveStateDb(args);
        const val = getValue(db, key);
        if (val === null) throw new CommandExecutionError(`Key not found: ${key}`, '');
        const max = Number.isInteger(args['max-bytes']) && args['max-bytes'] > 0 ? args['max-bytes'] : 8000;
        const valStr = typeof val === 'string' ? val : JSON.stringify(val, null, 2);
        const truncated = valStr.length > max;
        return [
            { Field: 'Key', Value: key },
            { Field: 'Type', Value: typeof val === 'string' ? 'string' : (Array.isArray(val) ? 'array' : typeof val) },
            { Field: 'Size', Value: `${valStr.length} chars${truncated ? ' (truncated)' : ''}` },
            { Field: 'Value', Value: truncated ? valStr.slice(0, max) + '\n...(truncated)' : valStr },
        ];
    },
});

// ====== FS-side: recent-paths ======
cli({
    site: 'antigravity',
    name: 'recent-paths',
    access: 'read',
    description: 'Show Antigravity\'s recently-opened folders/files (history.recentlyOpenedPathsList).',
    domain: 'localhost',
    strategy: Strategy.LOCAL,
    browser: false,
    args: [
        { name: 'limit', type: 'int', required: false, default: 20, help: 'Max rows to return' },
    ],
    columns: STORAGE_COLUMNS,
    func: async (args) => {
        const val = getValue(AG_GLOBAL_STATE_DB, 'history.recentlyOpenedPathsList');
        if (!val) throw new EmptyResultError('antigravity recent-paths', 'No recent paths recorded.');
        const entries = val.entries || [];
        if (!entries.length) throw new EmptyResultError('antigravity recent-paths', 'Recent paths list is empty.');
        const limit = Number.isInteger(args?.limit) && args.limit > 0 ? args.limit : 20;
        return entries.slice(0, limit).map((e, i) => {
            let kind = 'other', target = JSON.stringify(e).slice(0, 200);
            if (e.folderUri) {
                kind = 'folder';
                target = decodeURI(String(e.folderUri).replace(/^file:\/\//, ''));
            } else if (e.fileUri) {
                kind = 'file';
                target = decodeURI(String(e.fileUri).replace(/^file:\/\//, ''));
            } else if (e.workspace?.configPath) {
                kind = 'workspace';
                target = decodeURI(String(e.workspace.configPath).replace(/^file:\/\//, ''));
            }
            return { Index: i + 1, Kind: kind, Path: target };
        });
    },
});

// ====== FS-side: workspaces-list ======
cli({
    site: 'antigravity',
    name: 'workspaces-list',
    access: 'read',
    description: 'List Antigravity workspaceStorage entries (each represents a previously-opened folder).',
    domain: 'localhost',
    strategy: Strategy.LOCAL,
    browser: false,
    args: [
        { name: 'limit', type: 'int', required: false, default: 50, help: 'Max rows to return' },
    ],
    columns: STORAGE_COLUMNS,
    func: async (args) => {
        if (!fs.existsSync(AG_WORKSPACE_STORAGE)) {
            throw new CommandExecutionError(`workspaceStorage not found: ${AG_WORKSPACE_STORAGE}`, '');
        }
        const dirs = fs.readdirSync(AG_WORKSPACE_STORAGE).filter((n) => {
            const full = path.join(AG_WORKSPACE_STORAGE, n);
            return fs.statSync(full).isDirectory();
        });
        if (!dirs.length) throw new EmptyResultError('antigravity workspaces-list', 'No workspace storage.');
        const rows = dirs.map((id) => {
            const dir = path.join(AG_WORKSPACE_STORAGE, id);
            const wj = path.join(dir, 'workspace.json');
            let folder = '(no workspace.json)';
            if (fs.existsSync(wj)) {
                try {
                    const outer = JSON.parse(fs.readFileSync(wj, 'utf-8'));
                    if (outer.folder) folder = decodeURI(outer.folder.replace(/^file:\/\//, ''));
                    else if (outer.workspace) folder = '(multi-folder) ' + decodeURI(outer.workspace.replace(/^file:\/\//, ''));
                } catch { folder = '(invalid workspace.json)'; }
            }
            return { id, folder, mtime: fs.statSync(dir).mtimeMs };
        }).sort((a, b) => b.mtime - a.mtime);
        const limit = Number.isInteger(args?.limit) && args.limit > 0 ? args.limit : 50;
        return rows.slice(0, limit).map((r, i) => ({
            Index: i + 1,
            'Workspace Id': r.id,
            Folder: r.folder.slice(0, 120),
            Modified: new Date(r.mtime).toISOString().replace('T', ' ').slice(0, 19),
        }));
    },
});

// ====== Settings ======
cli({
    site: 'antigravity',
    name: 'settings-read',
    access: 'read',
    description: 'Read Antigravity\'s user settings.json (theme, proxy, agCockpit, tfa.system.autoAccept, etc.).',
    domain: 'localhost',
    strategy: Strategy.LOCAL,
    browser: false,
    args: [],
    columns: STORAGE_COLUMNS,
    func: async () => {
        if (!fs.existsSync(AG_SETTINGS_JSON)) {
            throw new CommandExecutionError(`settings.json not found: ${AG_SETTINGS_JSON}`, '');
        }
        const raw = fs.readFileSync(AG_SETTINGS_JSON, 'utf-8');
        // VSCode allows JSONC (line + block comments + trailing commas).
        // Strip comments and trailing commas before parsing.
        const stripped = raw
            .replace(/\/\*[\s\S]*?\*\//g, '')              // block comments
            .replace(/^\s*\/\/.*$/gm, '')                  // line comments (full line)
            .replace(/([^:"])\/\/.*$/gm, '$1')             // line comments (after code)
            .replace(/,(\s*[}\]])/g, '$1');                // trailing commas
        let obj;
        try { obj = JSON.parse(stripped); } catch (e) {
            throw new CommandExecutionError(`Failed to parse settings.json: ${e.message}`, '');
        }
        const rows = [];
        for (const [k, v] of Object.entries(obj)) {
            rows.push({ Field: k, Value: typeof v === 'object' ? JSON.stringify(v) : String(v) });
        }
        return rows;
    },
});
