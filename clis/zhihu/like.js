import { CliError, CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { assertAllowedKinds, parseTarget } from './target.js';
import { buildResultRow, requireExecute } from './write-shared.js';
cli({
    site: 'zhihu',
    name: 'like',
    access: 'write',
    description: 'Like a Zhihu answer or article',
    domain: 'zhihu.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'target', positional: true, required: true, help: 'Zhihu target URL or typed target' },
        { name: 'execute', type: 'boolean', help: 'Actually perform the write action' },
    ],
    columns: ['status', 'outcome', 'message', 'target_type', 'target'],
    func: async (page, kwargs) => {
        if (!page)
            throw new CommandExecutionError('Browser session required for zhihu like');
        requireExecute(kwargs);
        const rawTarget = String(kwargs.target);
        const target = assertAllowedKinds('like', parseTarget(rawTarget));
        await page.goto('https://www.zhihu.com');
        await page.wait(2);
        const apiResult = await page.evaluate(`(async () => {
            var targetKind = ${JSON.stringify(target.kind)};
            var targetId = ${JSON.stringify(target.id)};
            var resourceType = targetKind === 'answer' ? 'answers' : 'articles';
            var url = 'https://www.zhihu.com/api/v4/' + resourceType + '/' + targetId + '/voters';
            var resp = await fetch(url, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'up' }),
            });
            var data = await resp.json();
            if (!resp.ok) return { ok: false, message: data.error ? data.error.message : 'unknown error' };
            if (data && data.success === false) return { ok: false, message: 'Zhihu like API reported success=false' };
            return { ok: true, success: data.success };
        })()`);
        if (!apiResult?.ok) {
            throw new CliError('COMMAND_EXEC', apiResult?.message || 'Failed to like');
        }
        return buildResultRow(`Liked ${target.kind} ${target.id}`, target.kind, rawTarget, 'applied');
    },
});
