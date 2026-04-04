import { AuthRequiredError, CommandExecutionError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import { stripHtml } from './utils.js';

interface MentionItem {
  id?: number;
  msgType?: number;
  puid?: number;
  username?: string;
  headerUrl?: string;
  postContent?: string;
  threadTitle?: string;
  tid?: number;
  pid?: number;
  topicId?: number;
  quoteContent?: string;
  publishTime?: string;
  updateTime?: number;
}

interface BrowserMentionResult {
  ok?: boolean;
  status?: number;
  data?: {
    items: MentionItem[];
    hasNextPage: boolean;
    pageStr?: string;
  };
  error?: string;
}

cli({
  site: 'hupu',
  name: 'mentions',
  aliases: ['mention'],
  description: '查看虎扑提到我的回复 (需要登录)',
  domain: 'my.hupu.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  args: [
    {
      name: 'limit',
      type: 'int',
      default: 20,
      help: '最多返回多少条消息'
    },
    {
      name: 'max_pages',
      type: 'int',
      default: 3,
      help: '最多抓取多少页'
    },
    {
      name: 'page_str',
      help: '分页游标；不传时从第一页开始'
    }
  ],
  columns: ['time', 'username', 'thread_title', 'post_content', 'quote_content', 'reply_url'],
  func: async (page, kwargs) => {
    const plate = '1';
    const limit = Math.max(1, Math.min(Number(kwargs.limit) || 20, 100));
    const maxPages = Math.max(1, Math.min(Number(kwargs.max_pages) || 3, 10));
    const inputPageStr = kwargs.page_str ? String(kwargs.page_str) : '';
    const referer = `https://my.hupu.com/message?tabKey=${plate}`;

    await page.goto(referer);

    const result = await page.evaluate(`
      (async () => {
        const plate = ${JSON.stringify(plate)};
        const limit = ${JSON.stringify(limit)};
        const maxPages = ${JSON.stringify(maxPages)};
        let pageStr = ${JSON.stringify(inputPageStr)};
        const apiBase = 'https://my.hupu.com/pcmapi/pc/space/v1/getMentionedRemindList';
        const items = [];
        let hasNextPage = false;
        let nextPageStr = pageStr || '';

        const parseJson = async (response) => {
          const text = await response.text();
          try {
            return text ? JSON.parse(text) : {};
          } catch {
            return {
              message: text || 'invalid json response'
            };
          }
        };

        try {
          for (let pageIndex = 0; pageIndex < maxPages && items.length < limit; pageIndex++) {
            const url = new URL(apiBase);
            url.searchParams.set('plate', plate);
            if (pageStr) {
              url.searchParams.set('pageStr', pageStr);
            }

            const response = await fetch(url.toString(), {
              method: 'GET',
              credentials: 'include'
            });

            const api = await parseJson(response);

            if (response.status === 401 || response.status === 403) {
              return {
                ok: false,
                status: response.status,
                error: 'please log in to Hupu first'
              };
            }

            if (!response.ok) {
              return {
                ok: false,
                status: response.status,
                error: api?.msg || api?.message || ('HTTP ' + response.status)
              };
            }

            if ((api?.code ?? 0) > 1) {
              return {
                ok: false,
                status: response.status,
                error: api?.msg || api?.message || ('API error code=' + api?.code)
              };
            }

            const data = api?.data || {};
            const currentItems = Array.isArray(data.hisList) ? data.hisList : [];
            items.push(...currentItems);

            hasNextPage = Boolean(data.hasNextPage);
            nextPageStr = typeof data.pageStr === 'string' ? data.pageStr : '';

            if (!hasNextPage || !nextPageStr || nextPageStr === pageStr) {
              break;
            }

            pageStr = nextPageStr;
          }

          return {
            ok: true,
            data: {
              items: items.slice(0, limit),
              hasNextPage,
              pageStr: nextPageStr
            }
          };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          };
        }
      })()
    `) as BrowserMentionResult;

    if (!result || typeof result !== 'object') {
      throw new CommandExecutionError('Read Hupu mentions failed: invalid browser response');
    }

    if (result.status === 401 || result.status === 403) {
      throw new AuthRequiredError('my.hupu.com', 'Read Hupu mentions failed: please log in to Hupu first');
    }

    if (!result.ok) {
      throw new CommandExecutionError(`Read Hupu mentions failed: ${result.error || 'unknown error'}`);
    }

    const items = result.data?.items || [];
    return items.map((item) => {
      const tid = item.tid ? String(item.tid) : '';
      const pid = item.pid ? String(item.pid) : '';

      return {
        time: item.publishTime || '',
        username: item.username || '',
        thread_title: item.threadTitle || '',
        post_content: stripHtml(item.postContent || ''),
        quote_content: stripHtml(item.quoteContent || ''),
        url: tid ? `https://bbs.hupu.com/${tid}.html` : '',
        reply_url: tid && pid ? `https://bbs.hupu.com/${tid}.html?pid=${pid}` : '',
        tid,
        pid,
        topic_id: item.topicId ? String(item.topicId) : '',
        msg_type: item.msgType ?? '',
        has_next_page: result.data?.hasNextPage ?? false,
        next_page_str: result.data?.pageStr || ''
      };
    });
  },
});
