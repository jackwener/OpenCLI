import fs from 'node:fs';
import path from 'node:path';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';

// Safety cap only. Full-archive runs can set a higher page budget via --max-pages.
export const DEFAULT_MAX_PAGINATION_PAGES = 100;
const HARD_MAX_PAGINATION_PAGES = 100000;

export function resolveOptionalFilePath(raw, label) {
    if (raw === undefined || raw === null || raw === '')
        return '';
    const value = String(raw).trim();
    if (!value)
        throw new ArgumentError(`${label} cannot be empty`);
    return path.resolve(value);
}

export function ensureParentDir(filePath) {
    if (!filePath)
        return;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function removeFile(filePath) {
    if (!filePath)
        return;
    try {
        fs.rmSync(filePath, { force: true });
    }
    catch {
    }
}

export function loadJsonlArchiveState(filePath) {
    const seen = new Set();
    let count = 0;
    if (!filePath || !fs.existsSync(filePath))
        return { seen, count };
    const text = fs.readFileSync(filePath, 'utf8');
    for (const [index, line] of text.split('\n').entries()) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        try {
            const row = JSON.parse(trimmed);
            if (!row?.id)
                throw new Error('missing id');
            const id = String(row.id);
            if (seen.has(id))
                throw new Error(`duplicate id ${id}`);
            seen.add(id);
            count += 1;
        }
        catch (error) {
            throw new CommandExecutionError(`Invalid JSONL record in ${filePath} at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return { seen, count };
}

export function appendJsonlRows(filePath, rows) {
    if (!filePath || !Array.isArray(rows) || rows.length === 0)
        return;
    ensureParentDir(filePath);
    // Escape LS/PS so JSONL stays one physical line even when tweet text contains them.
    const text = rows
        .map((row) => JSON.stringify(row).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'))
        .join('\n') + '\n';
    fs.appendFileSync(filePath, text, 'utf8');
}

export function removeResumeFile(filePath) {
    removeFile(filePath);
}

export function resolveMaxPages(kwargs, fetchAll) {
    const raw = kwargs['max-pages'];
    if (raw === undefined || raw === null || raw === '') {
        return fetchAll ? HARD_MAX_PAGINATION_PAGES : DEFAULT_MAX_PAGINATION_PAGES;
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > HARD_MAX_PAGINATION_PAGES) {
        throw new ArgumentError(`--max-pages must be an integer between 1 and ${HARD_MAX_PAGINATION_PAGES}`);
    }
    return value;
}
