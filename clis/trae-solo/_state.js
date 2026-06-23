// Helpers for reading Trae SOLO's VSCode-style state.vscdb files.
//
// Trae SOLO stores UI/agent state in the same on-disk layout VSCode uses:
//   ~/Library/Application Support/TRAE SOLO/User/globalStorage/state.vscdb
//   ~/Library/Application Support/TRAE SOLO/User/workspaceStorage/<uuid>/state.vscdb
//
// Each is a SQLite database with a single table:
//   CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);
//
// We shell out to /usr/bin/sqlite3 (macOS ships it) so we avoid pulling a
// native sqlite dep into OpenCLI. Reads only — writing would race with
// Trae's own writer and corrupt the DB.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { TRAE_APP_SUPPORT } from './_fs.js';

export const TRAE_USER_DIR_APP = path.join(TRAE_APP_SUPPORT, 'User');
export const TRAE_GLOBAL_STATE_DB = path.join(
    TRAE_USER_DIR_APP,
    'globalStorage/state.vscdb',
);
export const TRAE_WORKSPACE_STORAGE = path.join(
    TRAE_USER_DIR_APP,
    'workspaceStorage',
);
export const TRAE_EXTENSIONS_JSON = path.join(
    process.env.HOME || '',
    '.trae/extensions/extensions.json',
);

// Run `sqlite3 <db> "<sql>"` and return stdout as a string. Throws
// CommandExecutionError on sqlite failure.
export function sqliteQuery(db, sql) {
    if (!fs.existsSync(db)) {
        throw new CommandExecutionError(
            `state.vscdb not found: ${db}`,
            'Has Trae SOLO been run at least once?',
        );
    }
    try {
        return execFileSync('/usr/bin/sqlite3', [db, sql], {
            encoding: 'utf-8',
            maxBuffer: 64 * 1024 * 1024,
        });
    } catch (e) {
        throw new CommandExecutionError(
            `sqlite3 failed on ${path.basename(db)}: ${e.message}`,
            'The DB may be locked by a running Trae SOLO instance. Try closing it or wait a few seconds.',
        );
    }
}

// List all keys in an ItemTable.
export function listKeys(db) {
    const out = sqliteQuery(db, 'SELECT key FROM ItemTable ORDER BY key;');
    return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

// Get a single value by key. Returns null if absent. Auto-parses JSON when
// possible.
export function getValue(db, key) {
    // Escape single quotes for sqlite literal.
    const esc = key.replace(/'/g, "''");
    const raw = sqliteQuery(
        db,
        `SELECT value FROM ItemTable WHERE key = '${esc}';`,
    ).trim();
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return raw;
    }
}

// Resolve a workspaceStorage workspace.json into a human-readable target.
// Trae writes two shapes:
//   { "folder": "file:///path/to/single-folder" }
//   { "workspace": "file:///.../Workspaces/<ts>/workspace.json" }  (multi-folder)
// For the multi-folder case we read the inner workspace.json and stringify
// its `folders` list.
export function resolveWorkspaceJson(wj) {
    if (!fs.existsSync(wj)) return { kind: 'missing', target: '(no workspace.json)' };
    let outer;
    try {
        outer = JSON.parse(fs.readFileSync(wj, 'utf-8'));
    } catch {
        return { kind: 'invalid', target: '(invalid JSON)' };
    }
    if (outer.folder) {
        return { kind: 'folder', target: decodeURI(outer.folder.replace(/^file:\/\//, '')) };
    }
    if (outer.workspace) {
        const inner = outer.workspace.replace(/^file:\/\//, '');
        const innerPath = decodeURI(inner);
        if (!fs.existsSync(innerPath)) {
            return { kind: 'workspace', target: '(missing) ' + innerPath };
        }
        try {
            const inn = JSON.parse(fs.readFileSync(innerPath, 'utf-8'));
            const folders = (inn.folders || []).map((f) => f.path || f.uri || JSON.stringify(f));
            return { kind: 'workspace', target: folders.join('; ') || '(empty workspace)' };
        } catch {
            return { kind: 'workspace', target: '(invalid inner) ' + innerPath };
        }
    }
    return { kind: 'unknown', target: JSON.stringify(outer).slice(0, 100) };
}
