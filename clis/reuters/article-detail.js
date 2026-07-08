/**
 * Reuters article-detail — full article body + canonical metadata.
 *
 * Pairs with `reuters search` (use the `url` column to round-trip into
 * detail). Reads the in-page Fusion globalContent payload + paragraph DOM.
 */
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { buildArticleDetailScript, mapArticleDetail } from './utils.js';

const REUTERS_HOST = /^https?:\/\/(?:www\.)?reuters\.com\//i;

cli({
    site: 'reuters',
    name: 'article-detail',
    access: 'read',
    description: 'Reuters 路透社文章详情：标题/作者/正文文本',
    domain: 'www.reuters.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'url', required: true, positional: true, help: 'Reuters article URL (must be on reuters.com)' },
    ],
    columns: ['title', 'date', 'section', 'section_path', 'authors', 'description', 'word_count', 'url', 'body'],
    func: async (page, kwargs) => {
        const url = String(kwargs.url || '').trim();
        if (!url) {
            throw new ArgumentError('Article URL cannot be empty');
        }
        if (!REUTERS_HOST.test(url)) {
            throw new ArgumentError(`URL must be on reuters.com, got ${url}`);
        }
        await page.goto(url);
        await page.wait(2);
        const result = await page.evaluate(buildArticleDetailScript());
        if (result?.error) {
            throw new CommandExecutionError(`Reuters article-detail failed inside the page: ${result.error}`);
        }
        if (result?.authRequired) {
            throw new AuthRequiredError('www.reuters.com', 'Reuters article-detail is gated by login, subscription, or human verification');
        }
        if (!result || result.ok !== true) {
            throw new CommandExecutionError(
                'Reuters article-detail returned no payload',
                'Check that the URL points to a Reuters article and that the page loaded',
            );
        }
        const detail = mapArticleDetail(result.body?.article, result.body?.bodyText, url);
        if (!detail || (!detail.title && !detail.body)) {
            throw new EmptyResultError('reuters article-detail', 'Page rendered no article body — likely paywalled or a non-article URL');
        }
        return [detail];
    },
});
