import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import { callNotebooklmRpc } from './rpc.js';
import { buildNotebooklmNotebookUrl, ensureNotebooklmHome, requireNotebooklmExecute, requireNotebooklmSession, verifyNotebooklmNotebookExists } from './utils.js';

const NOTEBOOKLM_CREATE_PROJECT_RPC_ID = 'CCqFvf';
const DEFAULT_EMOJI = '📒';
const MAX_TITLE_LEN = 200;
const NOTEBOOK_UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function parseCreateTitle(value) {
    const title = String(value ?? '').trim();
    if (!title) throw new ArgumentError('<title> is required');
    if (title.length > MAX_TITLE_LEN) {
        throw new ArgumentError(`Title must be at most ${MAX_TITLE_LEN} characters (got ${title.length})`);
    }
    return title;
}

export function parseCreateEmoji(value) {
    const emoji = String(value ?? '').trim();
    if (!emoji) return DEFAULT_EMOJI;
    return emoji;
}

export function parseCreateProjectResult(result) {
    let current = result;
    while (Array.isArray(current) && current.length === 1 && Array.isArray(current[0])) {
        current = current[0];
    }
    const id = Array.isArray(current)
        ? (typeof current[2] === 'string' && current[2])
            || (typeof current[0] === 'string' && current[0])
            || ''
        : '';
    return typeof id === 'string' && NOTEBOOK_UUID_RE.test(id) ? id : '';
}

cli({
    site: NOTEBOOKLM_SITE,
    name: 'create',
    access: 'write',
    description: 'Create a new NotebookLM notebook with the given title',
    domain: NOTEBOOKLM_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'title', positional: true, required: true, help: 'Notebook title (1-200 chars)' },
        { name: 'emoji', help: `Notebook emoji icon (default ${DEFAULT_EMOJI})` },
        { name: 'execute', type: 'boolean', help: 'Actually create the remote NotebookLM notebook' },
    ],
    columns: ['id', 'title', 'emoji', 'url'],
    func: async (page, kwargs) => {
        const title = parseCreateTitle(kwargs.title);
        const emoji = parseCreateEmoji(kwargs.emoji);
        requireNotebooklmExecute(kwargs.execute, 'create a NotebookLM notebook');
        await ensureNotebooklmHome(page);
        await requireNotebooklmSession(page);
        const rpc = await callNotebooklmRpc(page, NOTEBOOKLM_CREATE_PROJECT_RPC_ID, [title, emoji]);
        const notebookId = parseCreateProjectResult(rpc.result);
        if (!notebookId) {
            throw new CommandExecutionError('NotebookLM CreateProject RPC returned no notebook id');
        }
        await verifyNotebooklmNotebookExists(page, notebookId, 'create');
        return [{
            id: notebookId,
            title,
            emoji,
            url: buildNotebooklmNotebookUrl(notebookId),
        }];
    },
});

export const __test__ = { parseCreateTitle, parseCreateEmoji, parseCreateProjectResult };
