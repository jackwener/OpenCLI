// VSCode-style user settings.json reader for Trae SOLO.
//
//   settings-read     — parse and pretty-print
//                       ~/Library/Application Support/TRAE SOLO/User/settings.json
//
// Trae SOLO follows VSCode's JSONC settings convention (line/block comments
// + trailing commas allowed).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';
import { TRAE_APP_SUPPORT } from './_fs.js';

const TRAE_SETTINGS_JSON = path.join(TRAE_APP_SUPPORT, 'User/settings.json');

cli({
    site: 'trae-solo',
    name: 'settings-read',
    access: 'read',
    description: 'Parse and pretty-print Trae SOLO user settings.json (~/Library/Application Support/TRAE SOLO/User/settings.json). Handles VSCode JSONC syntax (line comments + trailing commas).',
    domain: 'localhost',
    strategy: Strategy.LOCAL,
    browser: false,
    args: [],
    columns: ['Field', 'Value'],
    func: async () => {
        if (!fs.existsSync(TRAE_SETTINGS_JSON)) {
            throw new EmptyResultError('trae-solo settings-read', `settings.json not found: ${TRAE_SETTINGS_JSON}`);
        }
        const raw = fs.readFileSync(TRAE_SETTINGS_JSON, 'utf-8');
        // Strip JSONC: line comments + block comments + trailing commas.
        const stripped = raw
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '')
            .replace(/([^:"])\/\/.*$/gm, '$1')
            .replace(/,(\s*[}\]])/g, '$1');
        let obj;
        try { obj = JSON.parse(stripped); } catch (e) {
            throw new CommandExecutionError(`Failed to parse settings.json: ${e.message}`, '');
        }
        const rows = [];
        for (const [k, v] of Object.entries(obj)) {
            rows.push({ Field: k, Value: typeof v === 'object' ? JSON.stringify(v) : String(v) });
        }
        if (!rows.length) {
            throw new EmptyResultError('trae-solo settings-read', 'settings.json is empty (or contains only defaults).');
        }
        return rows;
    },
});
