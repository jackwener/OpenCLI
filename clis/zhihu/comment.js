import { CliError, CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { assertAllowedKinds, parseTarget } from './target.js';
import { buildResultRow, requireExecute, resolveCurrentUserIdentity, resolvePayload } from './write-shared.js';
cli({
    site: 'zhihu',
    name: 'comment',
    access: 'write',
    description: 'Create a top-level comment on a Zhihu answer or article',
    domain: 'zhihu.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'target', positional: true, required: true, help: 'Zhihu target URL or typed target' },
        { name: 'text', positional: true, help: 'Comment text' },
        { name: 'file', help: 'Comment text file path' },
        { name: 'execute', type: 'boolean', help: 'Actually perform the write action' },
    ],
    columns: ['status', 'outcome', 'message', 'target_type', 'target', 'author_identity', 'created_url'],
    func: async (page, kwargs) => {
        if (!page)
            throw new CommandExecutionError('Browser session required for zhihu comment');
        requireExecute(kwargs);
        const rawTarget = String(kwargs.target);
        const target = assertAllowedKinds('comment', parseTarget(rawTarget));
        const payload = await resolvePayload(kwargs);
        await page.goto(target.url);
        await page.wait(3);
        const authorIdentity = await resolveCurrentUserIdentity(page);
        const apiResult = await page.evaluate(`(async () => {
            var targetKind = ${JSON.stringify(target.kind)};
            var targetId = ${JSON.stringify(target.id)};
            var content = ${JSON.stringify(payload)};
            var resourceType = targetKind === 'answer' ? 'answers' : 'articles';
            var url = 'https://www.zhihu.com/api/v4/' + resourceType + '/' + targetId + '/comments';
            var resp = await fetch(url, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: content }),
            });
            var data = await resp.json();
            if (!resp.ok) return { ok: false, status: resp.status, message: data.error ? data.error.message : 'unknown error' };
            if (!data || !data.id) return { ok: false, status: resp.status, message: 'Comment API response did not include a created comment id' };
            return { ok: true, id: data.id, url: data.url };
        })()`);
        if (!apiResult?.ok) {
            throw new CliError('COMMAND_EXEC', apiResult?.message || 'Failed to create comment');
        }
        return buildResultRow(`Commented on ${target.kind} ${target.id}`, target.kind, rawTarget, 'created', {
            author_identity: authorIdentity,
            created_url: apiResult.url || '',
        });
    },
});
