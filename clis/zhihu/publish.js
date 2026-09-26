import { CliError, CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { resolveCurrentUserIdentity, resolvePayload } from './write-shared.js';
cli({
    site: 'zhihu',
    name: 'publish',
    access: 'write',
    description: 'Publish a Zhihu column article (专栏文章). Without --execute, saves a private draft only.',
    domain: 'zhuanlan.zhihu.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'title', positional: true, required: true, help: 'Article title' },
        { name: 'text', positional: true, help: 'Article body as HTML' },
        { name: 'file', help: 'Path to an HTML file for the article body' },
        { name: 'execute', type: 'boolean', help: 'Actually publish. Omit to save a private draft only.' },
    ],
    columns: ['status', 'outcome', 'message', 'article_id', 'url', 'author_identity'],
    func: async (page, kwargs) => {
        if (!page)
            throw new CommandExecutionError('Browser session required for zhihu publish');
        const title = String(kwargs.title ?? '').trim();
        if (!title)
            throw new CliError('INVALID_INPUT', 'title is required');
        const content = await resolvePayload(kwargs);
        const execute = Boolean(kwargs.execute);
        // Same-origin context so the cookie-authenticated fetch calls succeed.
        await page.goto('https://zhuanlan.zhihu.com/');
        await page.wait(2);
        const authorIdentity = await resolveCurrentUserIdentity(page);
        const apiResult = await page.evaluate(`(async () => {
            var title = ${JSON.stringify(title)};
            var content = ${JSON.stringify(content)};
            var execute = ${JSON.stringify(execute)};
            var base = 'https://zhuanlan.zhihu.com/api/articles';
            var headers = { 'Content-Type': 'application/json' };

            // 1. create a draft
            var c = await fetch(base + '/drafts', { method: 'POST', credentials: 'include', headers: headers,
                body: JSON.stringify({ title: title, delta_time: 0, can_reward: false }) });
            if (!c.ok) return { ok: false, step: 'draft', status: c.status, message: (await c.text()).slice(0, 300) };
            var draft = await c.json();
            if (!draft || !draft.id) return { ok: false, step: 'draft', status: c.status, message: 'Draft API response did not include a draft id' };
            var id = String(draft.id);

            // 2. save title + HTML content
            var s = await fetch(base + '/' + id + '/draft', { method: 'PATCH', credentials: 'include', headers: headers,
                body: JSON.stringify({ title: title, content: content, delta_time: 30, table_of_contents: false }) });
            if (!s.ok) return { ok: false, step: 'save', status: s.status, id: id, message: (await s.text()).slice(0, 300) };

            if (!execute) {
                return { ok: true, id: id, published: false, url: 'https://zhuanlan.zhihu.com/p/' + id + '/edit' };
            }

            // 3. publish
            var p = await fetch(base + '/' + id + '/publish', { method: 'PUT', credentials: 'include', headers: headers,
                body: JSON.stringify({}) });
            var ptext = await p.text();
            if (!p.ok) return { ok: false, step: 'publish', status: p.status, id: id, message: ptext.slice(0, 300) };
            var url = 'https://zhuanlan.zhihu.com/p/' + id;
            try { var d = JSON.parse(ptext); if (d && d.url) url = d.url; } catch (e) {}
            return { ok: true, id: id, published: true, url: url };
        })()`);
        if (!apiResult?.ok) {
            throw new CliError('COMMAND_EXEC', `zhihu publish failed at step "${apiResult?.step ?? 'unknown'}": ${apiResult?.message ?? 'unknown error'}`);
        }
        const message = apiResult.published
            ? `Article published: ${title}`
            : 'Draft saved (private). Review the edit URL, then re-run with --execute to publish.';
        return [{
            status: 'success',
            outcome: apiResult.published ? 'published' : 'draft_saved',
            message,
            article_id: apiResult.id,
            url: apiResult.url,
            author_identity: authorIdentity,
        }];
    },
});
