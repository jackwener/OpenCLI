import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';

const FACEBOOK_HOME = 'https://www.facebook.com/';
const MAX_LIMIT = 50;

function requireLimit(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
    throw new ArgumentError(`facebook feed --limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  return n;
}

function unwrapBrowserResult(value) {
  if (value && typeof value === 'object' && 'data' in value) {
    return value.data;
  }
  return value;
}

function buildFeedExtractScript(limit) {
  return `(() => {
    const limit = ${limit};

    function clean(value) {
      return String(value || '').replace(/\\s+/g, ' ').trim();
    }

    function textOf(el) {
      return clean(el && el.textContent);
    }

    function labelOf(el) {
      return clean(el && el.getAttribute && el.getAttribute('aria-label'));
    }

    function isAuthPage() {
      const path = window.location && window.location.pathname ? window.location.pathname : '';
      const body = textOf(document.body);
      return /^\\/(login|checkpoint)(\\/|$|\\.php)/.test(path)
        || /^(Log in to Facebook|Facebook登录|登录 Facebook)/i.test(body)
        || /You must log in to continue/i.test(body);
    }

    function isExplicitEmptyFeed() {
      const body = textOf(document.body);
      return /No posts available|Nothing to show|暂无动态|没有更多动态|还没有帖子/i.test(body);
    }

    function isSuggestionOrChrome(text) {
      return /^(People you may know|People You May Know|可能认识的人?|你可能认识的人?)/i.test(text)
        || /^(Suggested for you|Suggested Groups|推荐小组|推荐内容)/i.test(text);
    }

    function isSponsored(text) {
      return /(^|\\s)(Sponsored|赞助|广告)(\\s|$)/i.test(text);
    }

    function isActionText(text) {
      return /^(Like|Comment|Share|Send|Follow|赞|评论|分享|发送|关注)$/i.test(text);
    }

    function isMetricText(text) {
      return /^(All:|所有心情：)/i.test(text)
        || /\\b(likes?|reactions?|comments?|shares?)\\b/i.test(text)
        || /(条评论|次分享)$/.test(text);
    }

    function isTimestampText(text) {
      return /^(\\d+\\s*(s|m|h|d|w|mo|yr|min|sec|second|minute|hour|day|week|month|year)s?|Just now|Yesterday|刚刚|昨天|\\d+小时|\\d+天)(\\s*[·•.])?$/i.test(text);
    }

    function postUrlFrom(root) {
      const links = Array.from(root.querySelectorAll('a[href]'));
      for (const link of links) {
        const href = link.href || link.getAttribute('href') || '';
        if (/\\/posts\\/|\\/permalink\\.php|\\/story\\.php|\\/photo\\/\\?fbid=|\\/groups\\/[^/]+\\/posts\\//i.test(href)) {
          return href;
        }
      }
      return '';
    }

    function actionKinds(root) {
      const kinds = new Set();
      for (const el of root.querySelectorAll('[aria-label]')) {
        const label = labelOf(el);
        if (/^(Like|赞)$/i.test(label)) kinds.add('like');
        if (/^(Comment|评论)$/i.test(label)) kinds.add('comment');
        if (/^(Share|分享)$/i.test(label)) kinds.add('share');
      }
      return kinds;
    }

    function visibleBlocks(root) {
      const seen = new Set();
      return Array.from(root.querySelectorAll('[dir="auto"]'))
        .map(textOf)
        .filter((text) => {
          if (!text || text.length > 600 || seen.has(text)) return false;
          seen.add(text);
          return true;
        });
    }

    function findAuthor(root) {
      const links = [
        root.querySelector('h2 a[href], h3 a[href], h4 a[href], strong a[href]'),
        ...Array.from(root.querySelectorAll('a[role="link"][href]')),
      ].filter(Boolean);
      for (const link of links) {
        const text = textOf(link);
        const href = link.href || link.getAttribute('href') || '';
        if (text.length > 1 && text.length <= 80
          && !isActionText(text)
          && !isMetricText(text)
          && !isTimestampText(text)
          && !/\\/groups\\/|\\/watch\\/|\\/reel\\/|\\/events\\/|\\/friends\\//i.test(href)) {
          return text;
        }
      }
      return '';
    }

    function contentBlocks(root, author) {
      return visibleBlocks(root).filter((text) => {
        if (text === author) return false;
        if (text.length <= 10) return false;
        if (isSuggestionOrChrome(text) || isSponsored(text)) return false;
        if (isActionText(text) || isMetricText(text) || isTimestampText(text)) return false;
        if (/^(See more|查看更多|更多)$/i.test(text)) return false;
        return true;
      });
    }

    function extractPost(root, index) {
      const fullText = textOf(root);
      if (!fullText || isSuggestionOrChrome(fullText) || isSponsored(fullText)) return null;

      const author = findAuthor(root);
      const blocks = contentBlocks(root, author);
      const content = clean(blocks.join(' '));
      const postUrl = postUrlFrom(root);
      const kinds = actionKinds(root);

      if (!author && !content) return null;
      if (!content && !postUrl && kinds.size < 2) return null;

      const likesMatch = fullText.match(/所有心情：\\s*(\\d[\\d,.\\s万亿KMk]*)/)
        || fullText.match(/All:\\s*(\\d[\\d,.KMk]*)/)
        || fullText.match(/(\\d[\\d,.KMk]*)\\s*(?:likes?|reactions?)/i);
      const commentsMatch = fullText.match(/([\\d,.]+\\s*[万亿]?)\\s*条评论/)
        || fullText.match(/(\\d[\\d,.KMk]*)\\s*comments?/i);
      const sharesMatch = fullText.match(/([\\d,.]+\\s*[万亿]?)\\s*次分享/)
        || fullText.match(/(\\d[\\d,.KMk]*)\\s*shares?/i);

      return {
        index,
        author: author.substring(0, 50),
        content: content.substring(0, 120),
        likes: likesMatch ? clean(likesMatch[1]) : '-',
        comments: commentsMatch ? clean(commentsMatch[1]) : '-',
        shares: sharesMatch ? clean(sharesMatch[1]) : '-',
      };
    }

    function primaryContainers() {
      return Array.from(document.querySelectorAll('[role="article"]'))
        .filter((el) => textOf(el).length > 30);
    }

    function fallbackContainers() {
      const main = document.querySelector('[role="main"]');
      if (!main) return [];
      const buttons = Array.from(main.querySelectorAll('[aria-label="Like"], [aria-label="赞"], [aria-label="Comment"], [aria-label="评论"], [aria-label="Share"], [aria-label="分享"]'));
      const seen = new WeakSet();
      const containers = [];
      for (const button of buttons) {
        let node = button.parentElement;
        for (let depth = 0; depth < 16 && node && node !== main && node !== document.body; depth += 1, node = node.parentElement) {
          const text = textOf(node);
          const kinds = actionKinds(node);
          const blocks = visibleBlocks(node);
          const hasPostEvidence = Boolean(postUrlFrom(node)) || blocks.some((block) => block.length > 20 && !isActionText(block) && !isMetricText(block));
          if (text.length >= 80 && kinds.has('like') && (kinds.has('comment') || kinds.has('share')) && hasPostEvidence) {
            if (!seen.has(node)) {
              seen.add(node);
              containers.push(node);
            }
            break;
          }
        }
      }
      return containers;
    }

    function dedupe(containers) {
      const seen = new Set();
      const result = [];
      for (const node of containers) {
        const key = postUrlFrom(node) || contentBlocks(node, findAuthor(node)).join('|').substring(0, 200);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        result.push(node);
      }
      return result;
    }

    if (isAuthPage()) return { status: 'auth', rows: [], diagnostics: {} };

    const primary = primaryContainers();
    const combined = dedupe([...primary, ...fallbackContainers()]);
    const rows = [];
    for (const container of combined) {
      const row = extractPost(container, rows.length + 1);
      if (row) rows.push(row);
      if (rows.length >= limit) break;
    }

    return {
      status: rows.length ? 'ok' : (isExplicitEmptyFeed() ? 'empty' : 'no_rows'),
      rows,
      diagnostics: {
        articleCount: document.querySelectorAll('[role="article"]').length,
        primaryCount: primary.length,
        fallbackActionCount: document.querySelectorAll('[role="main"] [aria-label="Like"], [role="main"] [aria-label="赞"], [role="main"] [aria-label="Comment"], [role="main"] [aria-label="评论"]').length,
        mainTextLength: textOf(document.querySelector('[role="main"]')).length,
      },
    };
  })()`;
}

async function getFacebookFeed(page, kwargs) {
  const limit = requireLimit(kwargs.limit ?? 10);
  try {
    await page.goto(FACEBOOK_HOME, { settleMs: 4000 });
  } catch (err) {
    throw new CommandExecutionError(
      `Failed to navigate to facebook feed: ${err instanceof Error ? err.message : err}`,
      'Check that facebook.com is reachable and the browser extension is connected.',
    );
  }

  let payload;
  try {
    payload = unwrapBrowserResult(await page.evaluate(buildFeedExtractScript(limit)));
  } catch (err) {
    throw new CommandExecutionError(
      `Failed to read facebook feed: ${err instanceof Error ? err.message : err}`,
      'Facebook may not have rendered or the feed markup may have changed.',
    );
  }

  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.rows)) {
    throw new CommandExecutionError('facebook feed returned malformed extraction payload');
  }

  if (payload.status === 'auth') {
    throw new AuthRequiredError('www.facebook.com', 'Open Chrome and log in to Facebook before retrying.');
  }

  if (payload.rows.length > 0) {
    return payload.rows;
  }

  if (payload.status === 'empty') {
    throw new EmptyResultError('facebook feed', 'Facebook did not show any feed posts for this account.');
  }

  const diagnostics = payload.diagnostics || {};
  if (diagnostics.articleCount || diagnostics.fallbackActionCount || diagnostics.mainTextLength > 200) {
    throw new CommandExecutionError(
      'facebook feed page rendered but no feed rows could be extracted',
      `Diagnostics: articles=${diagnostics.articleCount || 0}, actions=${diagnostics.fallbackActionCount || 0}, mainTextLength=${diagnostics.mainTextLength || 0}.`,
    );
  }

  throw new EmptyResultError('facebook feed', 'No Facebook feed content was visible in the current browser session.');
}

const command = {
  site: 'facebook',
  name: 'feed',
  access: 'read',
  description: 'Get your Facebook news feed',
  domain: 'www.facebook.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'limit', type: 'int', default: 10, help: 'Number of posts' },
  ],
  columns: ['index', 'author', 'content', 'likes', 'comments', 'shares'],
  func: getFacebookFeed,
};

cli(command);

export const __test__ = {
  buildFeedExtractScript,
  command,
  getFacebookFeed,
  requireLimit,
};
