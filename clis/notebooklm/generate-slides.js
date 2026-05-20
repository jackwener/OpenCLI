import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import { callNotebooklmRpc } from './rpc.js';
import { buildNotebooklmNotebookUrl, listNotebooklmSourcesViaRpc, parseNotebooklmNotebookTarget, requireNotebooklmSession } from './utils.js';

const NOTEBOOKLM_CREATE_ARTIFACT_RPC_ID = 'R7cb6c';
const SLIDE_DECK_CONFIG_BLOCK = [2, null, null, [1, null, null, null, null, null, null, null, null, null, [1]], [[1, 4, 2, 3, 6]]];
const ARTIFACT_UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function buildCreateSlidesArgs(projectId, sourceIds, options = {}) {
    const sourceTuples = sourceIds.map((id) => [[id]]);
    const language = options.language || 'en';
    const length = Number.isInteger(options.length) ? options.length : 3;
    return [
        SLIDE_DECK_CONFIG_BLOCK,
        projectId,
        [
            null,
            null,
            8,
            sourceTuples,
            null,
            null,
            null, null, null, null, null, null, null, null, null, null,
            [[null, language, 1, length]],
        ],
    ];
}

export function parseSlidesIdFromResult(result) {
    if (typeof result === 'string' && ARTIFACT_UUID_RE.test(result)) return result;
    const stack = [result];
    while (stack.length) {
        const node = stack.shift();
        if (typeof node === 'string' && ARTIFACT_UUID_RE.test(node)) return node;
        if (Array.isArray(node)) for (const child of node) stack.push(child);
        else if (node && typeof node === 'object') for (const v of Object.values(node)) stack.push(v);
    }
    return '';
}

cli({
    site: NOTEBOOKLM_SITE,
    name: 'generate-slides',
    access: 'write',
    description: 'Trigger a Slide Deck (AI presentation) generation for a NotebookLM notebook, using all of its sources',
    domain: NOTEBOOKLM_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'notebook', positional: true, required: true, help: 'Notebook id from `notebooklm list` or full notebook URL' },
        { name: 'length', help: 'Slide deck length: 1=Short, 3=Default (default 3)' },
        { name: 'language', help: 'Language code (default en)' },
    ],
    columns: ['notebook_id', 'slides_id', 'source_count', 'status', 'notebook_url'],
    func: async (page, kwargs) => {
        const notebookId = parseNotebooklmNotebookTarget(String(kwargs.notebook ?? ''));
        const length = kwargs.length === undefined || kwargs.length === '' ? 3 : Number(kwargs.length);
        const language = String(kwargs.language ?? 'en').trim() || 'en';
        try {
            await page.goto(buildNotebooklmNotebookUrl(notebookId));
            await page.wait(2);
        }
        catch (error) {
            throw new CommandExecutionError(`Failed to open NotebookLM notebook ${notebookId}: ${error?.message || error}`);
        }
        await requireNotebooklmSession(page);
        const sources = await listNotebooklmSourcesViaRpc(page);
        const sourceIds = sources.map((s) => s.id).filter((id) => typeof id === 'string' && id);
        if (sourceIds.length === 0) {
            throw new EmptyResultError('notebooklm generate-slides', 'The notebook has no sources; add a source before generating a slide deck.');
        }
        const rpc = await callNotebooklmRpc(page, NOTEBOOKLM_CREATE_ARTIFACT_RPC_ID, buildCreateSlidesArgs(notebookId, sourceIds, { length, language }));
        const slidesId = parseSlidesIdFromResult(rpc.result);
        if (!slidesId) {
            throw new CommandExecutionError('NotebookLM CreateArtifact (slides) RPC returned no slide-deck id; the server may have rejected the request.');
        }
        return [{
            notebook_id: notebookId,
            slides_id: slidesId,
            source_count: sourceIds.length,
            status: 'pending',
            notebook_url: buildNotebooklmNotebookUrl(notebookId),
        }];
    },
});

export const __test__ = { SLIDE_DECK_CONFIG_BLOCK, buildCreateSlidesArgs, parseSlidesIdFromResult };
