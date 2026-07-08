/**
 * Toutiao creator-backend article list — extracts article rows + basic metrics
 * from the rendered creator dashboard page text.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { looksToutiaoAuthWallText, parseArticlesPage, parseToutiaoArticlesText } from './utils.js';

cli({
    site: 'toutiao',
    name: 'articles',
    access: 'read',
    description: '获取头条号创作者后台文章列表及数据',
    domain: 'mp.toutiao.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'page', type: 'int', default: 1, help: '页码 (1-4)' },
    ],
    columns: ['title', 'date', 'status', '展现', '阅读', '点赞', '评论'],
    func: async (page, kwargs) => {
        const articlePage = parseArticlesPage(kwargs.page, 1);
        let text;
        try {
            await page.goto(`https://mp.toutiao.com/profile_v4/manage/content/all?page=${articlePage}`);
            await page.wait('networkidle');
            await page.wait(3);
            text = await page.evaluate(`
(async () => {
    await new Promise(r => setTimeout(r, 2000));
    return document.body.innerText || '';
})()
`);
        } catch (error) {
            throw new CommandExecutionError(`toutiao articles render failed: ${error?.message || error}`);
        }
        if (looksToutiaoAuthWallText(text)) {
            throw new AuthRequiredError('mp.toutiao.com', 'Toutiao creator articles require a logged-in mp.toutiao.com browser session');
        }
        const rows = parseToutiaoArticlesText(text);
        if (rows.length === 0) {
            throw new EmptyResultError(
                'toutiao articles',
                `未抓取到创作者后台文章 (page=${articlePage})。可能页面尚未完成渲染或无文章。`,
            );
        }
        return rows;
    },
});

export { parseToutiaoArticlesText };
export const __test__ = {
    parseToutiaoArticlesText,
    parseArticlesPage,
};
