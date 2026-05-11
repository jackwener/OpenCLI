import { EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { buildTiebaReadItems } from './utils.js';
function getThreadUrl(kwargs) {
    const threadId = String(kwargs.id || '');
    const pageNumber = Math.max(1, Number(kwargs.page || 1));
    return `https://tieba.baidu.com/p/${encodeURIComponent(threadId)}?pn=${pageNumber}`;
}
/**
 * Ensure the browser actually landed on the requested thread page before we trust the DOM.
 */
function assertTiebaReadTargetPage(raw, kwargs) {
    const expectedThreadId = String(kwargs.id || '').trim();
    const expectedPageNumber = Math.max(1, Number(kwargs.page || 1));
    const pathname = String(raw.pageMeta?.pathname || '').trim();
    const actualThreadId = pathname.match(/^\/p\/(\d+)/)?.[1] || '';
    const actualPn = String(raw.pageMeta?.pn || '').trim();
    if (!actualThreadId || actualThreadId !== expectedThreadId) {
        throw new EmptyResultError('tieba read', 'Tieba did not land on the requested thread page');
    }
    if (expectedPageNumber > 1 && actualPn !== String(expectedPageNumber)) {
        throw new EmptyResultError('tieba read', 'Tieba did not land on the requested page');
    }
}
function buildExtractReadEvaluate() {
    return `
    (async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitFor = async (predicate, timeoutMs = 4000) => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (predicate()) return true;
          await wait(100);
        }
        return false;
      };
      const normalizeText = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const getVueProps = (element) => {
        const vue = element && element.__vue__ ? element.__vue__ : null;
        return vue ? (vue._props || vue.$props || {}) : {};
      };
      const extractStructuredText = (content) => {
        if (!Array.isArray(content)) return '';
        return content
          .map((part) => (part && typeof part === 'object' && typeof part.text === 'string') ? part.text : '')
          .join('')
          .replace(/\\s+/g, ' ')
          .trim();
      };
      const parseFloor = (text) => {
        const match = (text || '').match(/第(\\d+)楼/);
        return match ? parseInt(match[1], 10) : 0;
      };

      await waitFor(() => {
        const hasMainTree = document.querySelector('.pb-title-wrap.pc-pb-title') || document.querySelector('.pb-content-wrap');
        return Boolean(hasMainTree || document.querySelector('.pb-comment-item'));
      });

      const titleNode = document.querySelector('.pb-title-wrap.pc-pb-title');
      const titleProps = getVueProps(titleNode);
      const mainUser = document.querySelector('.head-line.user-info:not(.no-extra-margin)');
      const mainUserProps = getVueProps(mainUser);
      const contentWrap = document.querySelector('.pb-content-wrap');
      const contentProps = getVueProps(contentWrap);
      const structuredContent = Array.isArray(contentProps.content) ? contentProps.content : [];
      const visibleContent = normalizeText(
        contentWrap?.querySelector('.pb-content-item .text')?.textContent
        || contentWrap?.querySelector('.text')?.textContent
        || contentWrap?.textContent
      );

      return {
        pageMeta: {
          pathname: window.location.pathname || '',
          pn: new URLSearchParams(window.location.search).get('pn') || '',
        },
        mainPost: {
          title: typeof titleProps.title === 'string' && titleProps.title.trim()
            ? titleProps.title.trim()
            : normalizeText(titleNode?.textContent).replace(/-百度贴吧$/, '').trim(),
          author: normalizeText(
            mainUser?.querySelector('.head-name')?.textContent
            || mainUser?.querySelector('.name-info .head-name')?.textContent
            || ''
          ),
          fallbackAuthor: mainUserProps?.userShowInfo?.[0]?.text?.text || '',
          contentText: visibleContent,
          structuredText: extractStructuredText(structuredContent),
          visibleTime: (() => {
            const userText = normalizeText(mainUser?.textContent);
            const match = userText.match(/(刚刚|昨天|前天|\\d+\\s*(?:分钟|小时|天)前|\\d{2}-\\d{2}(?:\\s+\\d{2}:\\d{2})?|\\d{4}-\\d{2}-\\d{2}(?:\\s+\\d{2}:\\d{2})?)/);
            return match ? match[1].trim() : '';
          })(),
          structuredTime: mainUserProps?.descInfo?.time || 0,
          hasMedia: structuredContent.length > 0 && !extractStructuredText(structuredContent),
        },
        replies: Array.from(document.querySelectorAll('.pb-comment-item')).map((item) => {
          const meta = item.querySelector('.comment-desc-left')?.textContent?.replace(/\\s+/g, ' ').trim() || '';
          return {
            floor: parseFloor(meta),
            author: item.querySelector('.head-name')?.textContent?.trim() || '',
            content: item.querySelector('.comment-content .pb-content-item .text')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
            time: meta,
          };
        }),
      };
    })()
  `;
}
cli({
    site: 'tieba',
    name: 'read',
    access: 'read',
    description: 'Read a tieba thread',
    domain: 'tieba.baidu.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'id', positional: true, required: true, type: 'string', help: 'Thread ID' },
        { name: 'page', type: 'int', default: 1, help: 'Page number' },
        { name: 'limit', type: 'int', default: 30, help: 'Number of replies to return' },
    ],
    columns: ['floor', 'author', 'content', 'time'],
    func: async (page, kwargs) => {
        const pageNumber = Math.max(1, Number(kwargs.page || 1));
        // Use the browser's normal settle path so we do not scrape stale DOM from the previous tab state.
        await page.goto(getThreadUrl(kwargs));
        const raw = (await page.evaluate(buildExtractReadEvaluate()) || {});
        assertTiebaReadTargetPage(raw, kwargs);
        const items = buildTiebaReadItems(raw, {
            limit: kwargs.limit,
            includeMainPost: pageNumber === 1,
        });
        if (!items.length) {
            throw new EmptyResultError('tieba read', 'Tieba may have blocked the thread page, or the DOM structure may have changed');
        }
        return items;
    },
});
