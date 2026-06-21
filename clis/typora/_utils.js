// Shared helpers for the Typora adapter.

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';

export const TYPORA_APP = '/Applications/Typora.app';

export function runJxa(script) {
    try {
        return execFileSync('osascript', ['-l', 'JavaScript', '-e', script], {
            encoding: 'utf-8',
            timeout: 20_000,
            stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
    } catch (err) {
        const stderr = err.stderr?.toString() || '';
        throw new Error(`AppleScript/JXA failed: ${err.message}${stderr ? ` (${stderr})` : ''}`);
    }
}

export function ensureTyporaInstalled() {
    if (!fs.existsSync(TYPORA_APP)) {
        throw new Error('Typora is not installed at /Applications/Typora.app. Install it from https://typora.io');
    }
}

export function activateTypora() {
    runJxa('Application("Typora").activate();');
}

export function getFrontDocumentPath() {
    const result = runJxa(`
        (function() {
            var t = Application("Typora");
            var docs = t.documents;
            if (docs.length === 0) return JSON.stringify({ path: null });
            var d = docs[0];
            return JSON.stringify({ path: d.path() });
        })();
    `);
    return JSON.parse(result).path;
}

export function openInTypora(filePath) {
    runJxa(`Application("Typora").open(${JSON.stringify(filePath)});`);
}
