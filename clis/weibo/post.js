/**
 * Weibo post — get a single post by ID.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { requireObjectEvaluateResult, unwrapEvaluateResult } from './utils.js';
cli({
    site: 'weibo',
    name: 'post',
    access: 'read',
    description: 'Get a single Weibo post',
    domain: 'weibo.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'id', required: true, positional: true, help: 'Post ID (numeric idstr or mblogid from URL)' },
    ],
    columns: ['field', 'value'],
    func: async (page, kwargs) => {
        await page.goto('https://weibo.com');
        await page.wait(2);
        const id = String(kwargs.id);
        const data = requireObjectEvaluateResult(unwrapEvaluateResult(await page.evaluate(`
      (async () => {
        const id = ${JSON.stringify(id)};
        const strip = (html) => (html || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();

        const resp = await fetch('/ajax/statuses/show?id=' + encodeURIComponent(id), {credentials: 'include'});
        if (!resp.ok) return {error: 'HTTP ' + resp.status};
        const s = await resp.json();
        if (!s.ok && !s.idstr) return {error: 'Post not found'};

        // Fetch long text if needed
        let fullText = s.text_raw || strip(s.text || '');
        if (s.isLongText || s.is_long_text) {
          try {
            const ltResp = await fetch('/ajax/statuses/longtext?id=' + s.idstr, {credentials: 'include'});
            if (ltResp.ok) {
              const lt = await ltResp.json();
              if (lt.data?.longTextContent) fullText = strip(lt.data.longTextContent);
            }
          } catch {}
        }

        const u = s.user || {};
        const result = {
          id: s.idstr || String(s.id),
          mblogid: s.mblogid,
          author: u.screen_name || '',
          text: fullText,
          created_at: s.created_at,
          source: strip(s.source || ''),
          reposts: s.reposts_count || 0,
          comments: s.comments_count || 0,
          likes: s.attitudes_count || 0,
          pic_count: s.pic_num || 0,
          url: 'https://weibo.com/' + (u.id || '') + '/' + (s.mblogid || ''),
        };

        if (s.retweeted_status) {
          const rt = s.retweeted_status;
          result.retweeted_from = (rt.user?.screen_name || '[deleted]');
          result.retweeted_text = rt.text_raw || strip(rt.text || '');
        }

        return result;
      })()
    `)), 'weibo post');
        if (data.error)
            throw new CommandExecutionError(String(data.error));
        return Object.entries(data).map(([field, value]) => ({
            field,
            value: String(value),
        }));
    },
});
