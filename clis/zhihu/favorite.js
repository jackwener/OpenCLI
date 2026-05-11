import { CliError, CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { assertAllowedKinds, parseTarget } from './target.js';
import { buildResultRow, requireExecute } from './write-shared.js';
function normalizeCollectionName(value) {
    return value
        .replace(/\s+/g, ' ')
        .replace(/\s+\d+\s*(条内容|个内容|items?)$/i, '')
        .replace(/\s+(公开|私密|默认)$/i, '')
        .trim();
}
cli({
    site: 'zhihu',
    name: 'favorite',
    access: 'write',
    description: 'Favorite a Zhihu answer or article into a specific collection',
    domain: 'zhihu.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'target', positional: true, required: true, help: 'Zhihu target URL or typed target' },
        { name: 'collection', help: 'Collection name' },
        { name: 'collection-id', help: 'Stable collection id' },
        { name: 'execute', type: 'boolean', help: 'Actually perform the write action' },
    ],
    columns: ['status', 'outcome', 'message', 'target_type', 'target', 'collection_name', 'collection_id'],
    func: async (page, kwargs) => {
        if (!page)
            throw new CommandExecutionError('Browser session required for zhihu favorite');
        requireExecute(kwargs);
        const rawTarget = String(kwargs.target);
        const target = assertAllowedKinds('favorite', parseTarget(rawTarget));
        const collectionName = typeof kwargs.collection === 'string' ? kwargs.collection : undefined;
        const collectionId = typeof kwargs['collection-id'] === 'string' ? kwargs['collection-id'] : undefined;
        if ((collectionName ? 1 : 0) + (collectionId ? 1 : 0) !== 1) {
            throw new CliError('INVALID_INPUT', 'Use exactly one of --collection or --collection-id');
        }
        await page.goto('https://www.zhihu.com');
        await page.wait(2);
        const apiResult = await page.evaluate(`(async () => {
            var collectionId = ${JSON.stringify(collectionId || null)};
            var collectionName = ${JSON.stringify(collectionName || null)};
            var targetKind = ${JSON.stringify(target.kind)};
            var targetId = ${JSON.stringify(target.id)};
            var normalizeCollectionName = function(value) {
                return String(value || '')
                    .replace(/\\s+/g, ' ')
                    .replace(/\\s+\\d+\\s*(条内容|个内容|items?)$/i, '')
                    .replace(/\\s+(公开|私密|默认)$/i, '')
                    .trim()
                    .toLowerCase();
            };

            if (!collectionId && collectionName) {
                var listResp = await fetch('https://www.zhihu.com/api/v4/people/self/collections?limit=50', { credentials: 'include' });
                if (!listResp.ok) return { ok: false, message: 'Failed to list collections: HTTP ' + listResp.status };
                var listData = {};
                try { listData = await listResp.json(); } catch(e) {
                    return { ok: false, message: 'Failed to parse collection list' };
                }
                var needle = normalizeCollectionName(collectionName);
                var matches = (listData.data || []).filter(function(c) { return normalizeCollectionName(c.title) === needle; });
                if (matches.length === 0) return { ok: false, message: 'Collection not found: ' + collectionName };
                if (matches.length > 1) return { ok: false, message: 'Collection name is ambiguous: ' + collectionName };
                collectionId = String(matches[0].id);
            }

            var resp = await fetch('https://www.zhihu.com/api/v4/favlists/' + collectionId + '/items', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ item_id: targetId, item_type: targetKind }),
            });
            if (resp.ok || resp.status === 204) return { ok: true, collectionId: collectionId };
            var data = {};
            try { data = await resp.json(); } catch(e) {}
            return { ok: false, message: data.error ? data.error.message : 'HTTP ' + resp.status };
        })()`);
        if (!apiResult?.ok) {
            throw new CliError('COMMAND_EXEC', apiResult?.message || 'Failed to favorite');
        }
        return buildResultRow(`Favorited ${target.kind} ${target.id}`, target.kind, rawTarget, 'applied', {
            collection_name: collectionName || '',
            collection_id: apiResult.collectionId || collectionId || '',
        });
    },
});
