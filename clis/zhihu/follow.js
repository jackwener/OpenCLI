import { CliError, CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { assertAllowedKinds, parseTarget } from './target.js';
import { buildResultRow, requireExecute } from './write-shared.js';
cli({
    site: 'zhihu',
    name: 'follow',
    access: 'write',
    description: 'Follow a Zhihu user or question',
    domain: 'www.zhihu.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'target', positional: true, required: true, help: 'Zhihu target URL or typed target' },
        { name: 'execute', type: 'boolean', help: 'Actually perform the write action' },
    ],
    columns: ['status', 'outcome', 'message', 'target_type', 'target'],
    func: async (page, kwargs) => {
        if (!page)
            throw new CommandExecutionError('Browser session required for zhihu follow');
        requireExecute(kwargs);
        const rawTarget = String(kwargs.target);
        const target = assertAllowedKinds('follow', parseTarget(rawTarget));
        await page.goto('https://www.zhihu.com');
        await page.wait(2);
        const apiResult = await page.evaluate(`(async () => {
            var targetKind = ${JSON.stringify(target.kind)};
            var targetId = ${JSON.stringify(target.kind === 'user' ? target.slug : target.id)};
            var url;
            if (targetKind === 'question') {
                url = 'https://www.zhihu.com/api/v4/questions/' + targetId + '/followers';
            } else if (targetKind === 'user') {
                url = 'https://www.zhihu.com/api/v4/members/' + targetId + '/followers';
            } else {
                return { ok: false, message: 'unsupported target type: ' + targetKind };
            }
            var resp = await fetch(url, { method: 'POST', credentials: 'include' });
            if (!resp.ok) {
                var data = {};
                try { data = await resp.json(); } catch(e) {}
                return { ok: false, message: data.error ? data.error.message : 'HTTP ' + resp.status };
            }
            return { ok: true };
        })()`);
        if (!apiResult?.ok) {
            throw new CliError('COMMAND_EXEC', apiResult?.message || 'Failed to follow');
        }
        return buildResultRow(`Followed ${target.kind} ${target.kind === 'user' ? target.slug : target.id}`, target.kind, rawTarget, 'applied');
    },
});
