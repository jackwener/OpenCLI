import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import { callNotebooklmRpc } from './rpc.js';
import { buildNotebooklmNotebookUrl, listNotebooklmSourcesViaRpc, parseNotebooklmNotebookTarget, requireNotebooklmExecute, requireNotebooklmSession } from './utils.js';

const NOTEBOOKLM_CREATE_AUDIO_RPC_ID = 'R7cb6c';
const AUDIO_OVERVIEW_CONFIG_BLOCK = [2, null, null, [1, null, null, null, null, null, null, null, null, null, [1]], [[1, 4, 2, 3, 6]]];
const AUDIO_UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function toExcludedUuidSet(excludedIds) {
    return new Set(excludedIds.map((id) => String(id ?? '').toLowerCase()).filter(Boolean));
}

export function buildCreateAudioArgs(projectId, sourceIds) {
    const sourceTuples = sourceIds.map((id) => [[id]]);
    const sourceTuplesTail = sourceIds.map((id) => [id]);
    return [
        AUDIO_OVERVIEW_CONFIG_BLOCK,
        projectId,
        [
            null,
            null,
            1,
            sourceTuples,
            null,
            null,
            [null, [null, null, null, sourceTuplesTail]],
        ],
    ];
}

export function parseAudioIdFromResult(result, excludedIds = []) {
    const excluded = toExcludedUuidSet(excludedIds);
    if (typeof result === 'string' && AUDIO_UUID_RE.test(result) && !excluded.has(result.toLowerCase())) return result;
    const stack = [result];
    while (stack.length) {
        const node = stack.shift();
        if (typeof node === 'string' && AUDIO_UUID_RE.test(node) && !excluded.has(node.toLowerCase())) return node;
        if (Array.isArray(node)) for (const child of node) stack.push(child);
        else if (node && typeof node === 'object') for (const v of Object.values(node)) stack.push(v);
    }
    return '';
}

cli({
    site: NOTEBOOKLM_SITE,
    name: 'generate-audio',
    access: 'write',
    description: 'Trigger an Audio Overview (Deep Dive podcast) generation for a NotebookLM notebook, using all of its sources',
    domain: NOTEBOOKLM_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'notebook', positional: true, required: true, help: 'Notebook id from `notebooklm list` or full notebook URL' },
        { name: 'execute', type: 'boolean', help: 'Actually trigger remote NotebookLM audio generation' },
    ],
    columns: ['notebook_id', 'audio_id', 'source_count', 'status', 'notebook_url'],
    func: async (page, kwargs) => {
        const notebookId = parseNotebooklmNotebookTarget(String(kwargs.notebook ?? ''));
        requireNotebooklmExecute(kwargs.execute, 'generate NotebookLM audio');
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
            throw new EmptyResultError('notebooklm generate-audio', 'The notebook has no sources; add a source before generating an audio overview.');
        }
        const rpc = await callNotebooklmRpc(page, NOTEBOOKLM_CREATE_AUDIO_RPC_ID, buildCreateAudioArgs(notebookId, sourceIds));
        const audioId = parseAudioIdFromResult(rpc.result, [notebookId, ...sourceIds]);
        if (!audioId) {
            throw new CommandExecutionError('NotebookLM CreateAudioOverview RPC returned no audio id; server may have rejected the request.');
        }
        return [{
            notebook_id: notebookId,
            audio_id: audioId,
            source_count: sourceIds.length,
            status: 'pending',
            notebook_url: buildNotebooklmNotebookUrl(notebookId),
        }];
    },
});

export const __test__ = { AUDIO_OVERVIEW_CONFIG_BLOCK, buildCreateAudioArgs, parseAudioIdFromResult };
