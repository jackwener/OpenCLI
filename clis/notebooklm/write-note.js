import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import { callNotebooklmRpc } from './rpc.js';
import { buildNotebooklmNotebookUrl, ensureNotebooklmHome, parseNotebooklmNotebookTarget, requireNotebooklmExecute, requireNotebooklmSession } from './utils.js';

const NOTEBOOKLM_CREATE_NOTE_RPC_ID = 'CYK0Xb';
const NOTEBOOKLM_MUTATE_NOTE_RPC_ID = 'cYAfTb';
const MAX_TITLE_LEN = 200;
const MAX_CONTENT_LEN = 1_000_000;
const NOTE_UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function parseNoteTitle(value) {
    const title = String(value ?? '').trim();
    if (!title) throw new ArgumentError('--title is required');
    if (title.length > MAX_TITLE_LEN) {
        throw new ArgumentError(`--title must be at most ${MAX_TITLE_LEN} characters (got ${title.length})`);
    }
    return title;
}

export function parseNoteContent(value) {
    const content = String(value ?? '');
    if (!content) throw new ArgumentError('--content is required');
    if (content.length > MAX_CONTENT_LEN) {
        throw new ArgumentError(`--content exceeds ${MAX_CONTENT_LEN} characters; split into smaller notes.`);
    }
    return content;
}

export function buildCreateNoteShellArgs(projectId) {
    return [projectId, '', [1], null, 'New Note', null, [2]];
}

export function buildMutateNoteArgs(projectId, noteId, content, title) {
    return [projectId, noteId, [[[content, title, [], 0]]], [2]];
}

function toExcludedUuidSet(excludedIds) {
    return new Set(excludedIds.map((id) => String(id ?? '').toLowerCase()).filter(Boolean));
}

export function parseNoteIdFromResult(result, excludedIds = []) {
    const excluded = toExcludedUuidSet(excludedIds);
    if (typeof result === 'string') return NOTE_UUID_RE.test(result) && !excluded.has(result.toLowerCase()) ? result : '';
    const stack = [result];
    while (stack.length) {
        const node = stack.shift();
        if (typeof node === 'string') {
            if (NOTE_UUID_RE.test(node) && !excluded.has(node.toLowerCase())) return node;
            continue;
        }
        if (Array.isArray(node)) for (const child of node) stack.push(child);
        else if (node && typeof node === 'object') for (const v of Object.values(node)) stack.push(v);
    }
    return '';
}

cli({
    site: NOTEBOOKLM_SITE,
    name: 'write-note',
    access: 'write',
    description: 'Create a Studio note in an existing NotebookLM notebook with the given title and Markdown content',
    domain: NOTEBOOKLM_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'notebook', positional: true, required: true, help: 'Notebook id from `notebooklm list` or full notebook URL' },
        { name: 'title', required: true, help: 'Note title (1-200 chars)' },
        { name: 'content', required: true, help: 'Note body as Markdown' },
        { name: 'execute', type: 'boolean', help: 'Actually create the remote NotebookLM note' },
    ],
    columns: ['notebook_id', 'note_id', 'title', 'notebook_url'],
    func: async (page, kwargs) => {
        const notebookId = parseNotebooklmNotebookTarget(String(kwargs.notebook ?? ''));
        const title = parseNoteTitle(kwargs.title);
        const content = parseNoteContent(kwargs.content);
        requireNotebooklmExecute(kwargs.execute, 'create a NotebookLM note');
        await ensureNotebooklmHome(page);
        await requireNotebooklmSession(page);
        const shellRpc = await callNotebooklmRpc(page, NOTEBOOKLM_CREATE_NOTE_RPC_ID, buildCreateNoteShellArgs(notebookId));
        const noteId = parseNoteIdFromResult(shellRpc.result, [notebookId]);
        if (!noteId) {
            throw new CommandExecutionError('NotebookLM CreateNote RPC returned no note id');
        }
        await callNotebooklmRpc(page, NOTEBOOKLM_MUTATE_NOTE_RPC_ID, buildMutateNoteArgs(notebookId, noteId, content, title));
        return [{
            notebook_id: notebookId,
            note_id: noteId,
            title,
            notebook_url: buildNotebooklmNotebookUrl(notebookId),
        }];
    },
});

export const __test__ = {
    parseNoteTitle,
    parseNoteContent,
    buildCreateNoteShellArgs,
    buildMutateNoteArgs,
    parseNoteIdFromResult,
};
