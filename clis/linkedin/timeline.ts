import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/types';
import { AuthRequiredError, EmptyResultError } from '@jackwener/opencli/errors';

interface TimelinePost {
  rank?: number;
  id: string;
  author: string;
  author_url: string;
  headline: string;
  text: string;
  posted_at: string;
  reactions: number;
  comments: number;
  url: string;
}

interface ExtractedBatch {
  loginRequired?: boolean;
  posts?: TimelinePost[];
}

function normalizeWhitespace(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function parseMetric(value: unknown): number {
  const raw = normalizeWhitespace(value).toLowerCase();
  if (!raw) return 0;

  const compact = raw.replace(/,/g, '');
  const match = compact.match(/(\d+(?:\.\d+)?)(k|m)?/i);
  if (!match) return 0;

  const base = Number(match[1]);
  const suffix = (match[2] || '').toLowerCase();
  if (suffix === 'k') return Math.round(base * 1000);
  if (suffix === 'm') return Math.round(base * 1000000);
  return Math.round(base);
}

function buildPostId(post: Partial<TimelinePost>): string {
  const url = normalizeWhitespace(post.url);
  if (url) return url;

  const author = normalizeWhitespace(post.author);
  const text = normalizeWhitespace(post.text);
  const postedAt = normalizeWhitespace(post.posted_at);
  return `${author}::${postedAt}::${text.slice(0, 120)}`;
}

function mergeTimelinePosts(existing: TimelinePost[], batch: TimelinePost[]): TimelinePost[] {
  const seen = new Set(existing.map(post => post.id));
  const merged = [...existing];

  for (const rawPost of batch) {
    const post: TimelinePost = {
      id: buildPostId(rawPost),
      author: normalizeWhitespace(rawPost.author),
      author_url: normalizeWhitespace(rawPost.author_url),
      headline: normalizeWhitespace(rawPost.headline),
      text: normalizeWhitespace(rawPost.text),
      posted_at: normalizeWhitespace(rawPost.posted_at),
      reactions: Number(rawPost.reactions) || 0,
      comments: Number(rawPost.comments) || 0,
      url: normalizeWhitespace(rawPost.url),
    };

    if (!post.author || !post.text) continue;
    if (seen.has(post.id)) continue;
    seen.add(post.id);
    merged.push(post);
  }

  return merged;
}

async function extractVisiblePosts(page: IPage): Promise<ExtractedBatch> {
  return page.evaluate(`(function () {
    function normalize(value) {
      return String(value || '').replace(/\\s+/g, ' ').trim();
    }
    function textOf(root, selector) {
      var el = root.querySelector(selector);
      return el ? el.textContent : '';
    }
    function hrefOf(root, selector) {
      var el = root.querySelector(selector);
      return el && el.href ? el.href : '';
    }
    function attrOf(root, selector, attr) {
      var el = root.querySelector(selector);
      return el ? el.getAttribute(attr) : '';
    }
    function cleanTimestamp(value) {
      return normalize(String(value || '').replace(/[•.]/g, ' '));
    }
    function parseMetric(value) {
      var raw = normalize(value).toLowerCase();
      var match;
      var base;
      var suffix;
      if (!raw) return 0;
      match = raw.replace(/,/g, '').match(/(\\d+(?:\\.\\d+)?)(k|m)?/i);
      if (!match) return 0;
      base = Number(match[1]);
      suffix = (match[2] || '').toLowerCase();
      if (suffix === 'k') return Math.round(base * 1000);
      if (suffix === 'm') return Math.round(base * 1000000);
      return Math.round(base);
    }
    function splitBlocks(text) {
      var lines = String(text || '').split('\\n');
      var blocks = [];
      var current = [];
      var i;
      var line;
      for (i = 0; i < lines.length; i += 1) {
        line = normalize(lines[i]);
        if (!line) {
          if (current.length) {
            blocks.push(normalize(current.join(' ')));
            current = [];
          }
          continue;
        }
        current.push(line);
      }
      if (current.length) blocks.push(normalize(current.join(' ')));
      return blocks;
    }
    function looksLikeTimestamp(value) {
      var lower = String(value || '').toLowerCase();
      return /^\\d+\\s*(s|m|h|d|w|mo|yr|min)(\\s*[•.])?$/i.test(lower);
    }
    function looksLikeBadge(value) {
      var lower = String(value || '').toLowerCase();
      return String(value || '').indexOf('•') === 0
        || lower === '1st'
        || lower === '2nd'
        || lower === '3rd'
        || lower === 'degree connection';
    }
    function looksLikeAction(value) {
      return /^(follow|send message|connect|visit my website|view my newsletter|subscribe)$/i.test((value || '').toLowerCase());
    }
    function looksLikeCta(value) {
      return /^(book an appointment|view my services|visit my website|view my newsletter|subscribe|learn more|contact us)$/i.test((value || '').toLowerCase());
    }
    function looksLikeEngagement(value) {
      return /(reactions?|comments?|reposts?)/i.test(String(value || ''));
    }
    function looksLikeFooterAction(value) {
      return /^(like|comment|repost|send|reply|load more comments)$/i.test((value || '').toLowerCase());
    }
    function findActivityUrn(root) {
      var elements = [root].concat(Array.from(root.querySelectorAll('*')));
      var i;
      var j;
      var attrs;
      var value;
      var match;
      for (i = 0; i < elements.length; i += 1) {
        attrs = Array.from(elements[i].attributes || []);
        for (j = 0; j < attrs.length; j += 1) {
          value = String(attrs[j].value || '');
          match = value.match(/urn:li:activity:\\d+/);
          if (match) return match[0];
        }
      }
      return '';
    }
    function parseReactionCount(root, blocks) {
      var direct = textOf(root, '.social-details-social-counts__reactions-count');
      var rootText = String(root.innerText || '');
      var i;
      var value;
      value = rootText.match(/and\\s+(\\d[\\d,]*)\\s+others\\s+reacted/i);
      if (value) return parseMetric(value[1]) + 1;
      value = rootText.match(/and\\s+(\\d[\\d,]*)\\s+others(?!\\s+comments?)(?!\\s+reposts?)/i);
      if (value) return parseMetric(value[1]) + 1;
      value = rootText.match(/(\\d[\\d,]*)\\s+reactions?/i);
      if (value) return parseMetric(value[0]);
      if (direct) return parseMetric(direct);
      for (i = 0; i < blocks.length; i += 1) {
        value = blocks[i];
        if (/and\\s+\\d[\\d,]*\\s+others(?!\\s+comments?)(?!\\s+reposts?)/i.test(value)) {
          return parseMetric(value) + 1;
        }
        if (/reactions?/i.test(value)) return parseMetric(value);
        if (/and\\s+\\d+[\\d,]*\\s+others\\s+reacted/i.test(value)) return parseMetric(value) + 1;
      }
      return 0;
    }
    function parseCommentCount(blocks) {
      var i;
      var text = blocks.join(' ');
      var match = text.match(/(\\d[\\d,]*)\\s+comments?/i);
      if (match) return parseMetric(match[0]);
      for (i = 0; i < blocks.length; i += 1) {
        if (/comments?/i.test(blocks[i])) return parseMetric(blocks[i]);
      }
      return 0;
    }
    function selectProfileLink(root, author) {
      var links = Array.from(root.querySelectorAll('a[href*="/in/"], a[href*="/company/"]'));
      var normalizedAuthor = normalize(author).toLowerCase();
      var i;
      var label;
      for (i = 0; i < links.length; i += 1) {
        label = normalize(links[i].textContent || links[i].getAttribute('aria-label')).toLowerCase();
        if (!links[i].href) continue;
        if (normalizedAuthor && label.indexOf(normalizedAuthor) >= 0) return links[i];
      }
      return links[0] || null;
    }
    function selectProfileUrl(root, author) {
      var link = selectProfileLink(root, author);
      return link && link.href ? link.href : '';
    }
    function parseActorLinkMeta(root, author) {
      var link = selectProfileLink(root, author);
      var text = normalize(link ? link.textContent : '');
      var normalizedAuthor = normalize(author);
      var match;
      var rest;
      var headline = '';
      var postedAt = '';
      if (!text || !normalizedAuthor) return { headline: '', postedAt: '' };
      if (text.indexOf(normalizedAuthor) === 0) {
        rest = normalize(text.slice(normalizedAuthor.length));
      } else {
        rest = text;
      }
      rest = normalize(rest.replace(/^[•·]\\s*(1st|2nd|3rd\\+?|3rd|degree connection)/i, ''));
      match = rest.match(/(\\d+\\s*(?:s|m|h|d|w|mo|yr|min))\\s*[•·]?$/i);
      if (match) {
        postedAt = cleanTimestamp(match[1]);
        headline = normalize(rest.slice(0, rest.length - match[0].length));
      } else {
        headline = rest;
      }
      headline = normalize(headline.replace(/^(book an appointment|view my services|visit my website|view my newsletter)\\s*/i, ''));
      return { headline: headline, postedAt: postedAt };
    }
    function stripBodyTail(value) {
      return normalize(String(value || '')
        .replace(/\\s+\\d[\\d,]*\\s+reactions?[\\s\\S]*$/i, '')
        .replace(/\\s+\\d[\\d,]*\\s+comments?[\\s\\S]*$/i, '')
        .replace(/\\s+[A-Z][^\\n]+\\s+and\\s+\\d[\\d,]*\\s+others\\s+reacted[\\s\\S]*$/i, '')
        .replace(/\\s+Like\\s+Comment\\s+Repost\\s+Send[\\s\\S]*$/i, '')
        .replace(/\\s+Reaction button state:[\\s\\S]*$/i, '')
        .replace(/^\\d+\\s*(?:s|m|h|d|w|mo|yr|min)\\s*[•.]?\\s*Follow\\s+/i, '')
      );
    }
    function parseActorMeta(root) {
      var actorLink = root.querySelector('a[href*="/in/"], a[href*="/company/"]');
      var actorText = normalize(actorLink ? actorLink.textContent : '');
      var author = '';
      var headline = '';
      var postedAt = '';
      var match;
      if (actorText) {
        match = actorText.match(/^(.+?)\\s+[•·]\\s+(1st|2nd|3rd\\+?|3rd|degree connection)(.*)$/i);
        if (match) {
          author = normalize(match[1]);
          actorText = normalize(match[3]);
        }
      }
      match = actorText.match(/(.+?)\\s+(\\d+\\s*(?:s|m|h|d|w|mo|yr|min))\\s*[•·]?$/i);
      if (match) {
        headline = normalize(match[1]);
        postedAt = cleanTimestamp(match[2]);
      } else if (actorText) {
        headline = actorText;
      }
      return {
        author: author,
        headline: headline,
        postedAt: postedAt,
        authorUrl: actorLink && actorLink.href ? actorLink.href : '',
      };
    }
    function extractFromListItem(root) {
      var blocks = splitBlocks(root.innerText || '');
      var filtered = [];
      var i;
      var value;
      var author = '';
      var authorUrl = '';
      var headline = '';
      var postedAt = '';
      var text = '';
      var bodyStart = -1;
      var permalink;
      var url;
      var reactions;
      var comments;
      var endIndex = -1;
      var urn;

      if (blocks.length < 5) return null;
      if (blocks[0] !== 'Feed post') return null;

      for (i = 1; i < blocks.length; i += 1) {
        value = blocks[i];
        if (!value) continue;
        if (/commented on this|reposted this|liked this|suggested/i.test(value)) continue;
        filtered.push(value);
      }
      if (filtered.length < 4) return null;

      for (i = 0; i < filtered.length; i += 1) {
        value = filtered[i];
        if (!author && !looksLikeBadge(value) && !looksLikeAction(value) && !looksLikeTimestamp(value)) {
          author = value;
          continue;
        }
        if (author && !headline && !looksLikeBadge(value) && !looksLikeAction(value) && !looksLikeTimestamp(value) && !looksLikeCta(value)) {
          headline = value;
          continue;
        }
        if (!postedAt && looksLikeTimestamp(value)) {
          postedAt = cleanTimestamp(value);
          continue;
        }
      }

      if (!author) return null;
      authorUrl = selectProfileUrl(root, author);
      if (!headline || !postedAt) {
        var actorMeta = parseActorLinkMeta(root, author);
        if (!headline && actorMeta.headline) headline = actorMeta.headline;
        if (!postedAt && actorMeta.postedAt) postedAt = actorMeta.postedAt;
      }

      for (i = 0; i < filtered.length; i += 1) {
        value = filtered[i];
        if (looksLikeAction(value)) {
          bodyStart = i + 1;
          break;
        }
      }
      if (bodyStart < 0 && postedAt) {
        bodyStart = filtered.indexOf(postedAt) + 1;
      }
      if (bodyStart < 0) bodyStart = Math.min(filtered.length, headline ? 2 : 1);

      for (i = bodyStart; i < filtered.length; i += 1) {
        value = filtered[i];
        if (looksLikeEngagement(value) || looksLikeFooterAction(value)) {
          endIndex = i;
          break;
        }
      }
      if (endIndex < 0) endIndex = filtered.length;

      text = stripBodyTail(filtered.slice(bodyStart, endIndex).join('\\n\\n'));
      if (!text) return null;

      permalink = root.querySelector('a[href*="/feed/update/"], a[href*="/posts/"], a[href*="/pulse/"]');
      url = permalink ? permalink.href : '';
      urn = findActivityUrn(root);
      if (!url && urn) url = 'https://www.linkedin.com/feed/update/' + urn + '/';
      reactions = parseReactionCount(root, filtered);
      comments = parseCommentCount(filtered);

      return {
        id: url || (author + '::' + postedAt + '::' + text.slice(0, 120)),
        author: author,
        author_url: authorUrl,
        headline: headline,
        text: text,
        posted_at: postedAt,
        reactions: reactions,
        comments: comments,
        url: url,
      };
    }
    function commentMetric(root) {
      var links = Array.from(root.querySelectorAll('button, a'));
      var i;
      var label;
      for (i = 0; i < links.length; i += 1) {
        label = normalize(links[i].textContent || links[i].getAttribute('aria-label'));
        if (/comment/i.test(label)) return parseMetric(label);
      }
      return 0;
    }

    var currentUrl = window.location.href;
    var path = String(window.location.pathname || '');
    var loginRequired = path.indexOf('/login') >= 0
      || path.indexOf('/checkpoint/') >= 0
      || Boolean(document.querySelector('input[name="session_key"], form.login__form'));
    var moreButtons = Array.from(document.querySelectorAll('button, a[role="button"]'))
      .filter(function (el) {
        return /see more|more/i.test(normalize(el.textContent))
          || /see more|more/i.test(normalize(el.getAttribute('aria-label')));
      })
      .slice(0, 8);
    var cards = Array.from(document.querySelectorAll('article, .feed-shared-update-v2, .occludable-update, [role="listitem"]'));
    var seen = new Set();
    var posts = [];
    var i;
    var card;
    var root;
    var author;
    var headline;
    var text;
    var postedAt;
    var permalink;
    var url;
    var reactions;
    var comments;

    for (i = 0; i < moreButtons.length; i += 1) {
      try { moreButtons[i].click(); } catch (err) {}
    }

    for (i = 0; i < cards.length; i += 1) {
      card = cards[i];
      root = card.closest('article, .feed-shared-update-v2, .occludable-update, [role="listitem"]') || card;
      if (!root || seen.has(root)) continue;
      seen.add(root);

      if (String(root.getAttribute('role') || '') === 'listitem') {
        var extracted = extractFromListItem(root);
        if (extracted) posts.push(extracted);
        continue;
      }

      author = normalize(
        textOf(root, '.update-components-actor__title span[dir="ltr"]')
        || textOf(root, '.update-components-actor__title')
        || textOf(root, '[data-control-name="actor"] span[dir="ltr"]')
        || textOf(root, '[data-control-name="actor"]')
      );
      headline = normalize(
        textOf(root, '.update-components-actor__description')
        || textOf(root, '.update-components-actor__sub-description')
      );
      text = normalize(
        textOf(root, '.update-components-text span[dir="ltr"]')
        || textOf(root, '.update-components-text')
        || textOf(root, '.feed-shared-inline-show-more-text span[dir="ltr"]')
        || textOf(root, '.feed-shared-inline-show-more-text')
        || textOf(root, '[data-test-id="main-feed-activity-card"] .break-words')
      );
      postedAt = normalize(
        textOf(root, '.update-components-actor__sub-description a')
        || textOf(root, '.update-components-actor__sub-description span[aria-hidden="true"]')
        || textOf(root, 'time')
      );
      permalink = root.querySelector('a[href*="/feed/update/"], a[href*="/posts/"], a[href*="/pulse/"]');
      url = permalink ? permalink.href : '';
      if (url && url.indexOf('/') === 0) url = new URL(url, currentUrl).toString();
      reactions = parseMetric(
        textOf(root, '.social-details-social-counts__reactions-count')
        || attrOf(root, '[aria-label*="reaction"]', 'aria-label')
        || attrOf(root, '[aria-label*="like"]', 'aria-label')
      );
      comments = commentMetric(root);

      if (!author || !text) continue;

      posts.push({
        id: url || (author + '::' + postedAt + '::' + text.slice(0, 120)),
        author: author,
        author_url: hrefOf(root, 'a[href*="/in/"], a[href*="/company/"]'),
        headline: headline,
        text: text,
        posted_at: postedAt,
        reactions: reactions,
        comments: comments,
        url: url,
      });
    }

    return { loginRequired: loginRequired, posts: posts };
  })()`);
}

cli({
  site: 'linkedin',
  name: 'timeline',
  description: 'Read LinkedIn home timeline posts',
  domain: 'www.linkedin.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of posts to return (max 100)' },
  ],
  columns: ['rank', 'author', 'author_url', 'headline', 'text', 'posted_at', 'reactions', 'comments', 'url'],
  func: async (page, kwargs) => {
    const limit = Math.max(1, Math.min(kwargs.limit ?? 20, 100));

    await page.goto('https://www.linkedin.com/feed/');
    await page.wait(4);

    let posts: TimelinePost[] = [];
    let sawLoginWall = false;

    for (let i = 0; i < 6 && posts.length < limit; i++) {
      const batch = await extractVisiblePosts(page);
      if (batch?.loginRequired) sawLoginWall = true;
      posts = mergeTimelinePosts(posts, Array.isArray(batch?.posts) ? batch.posts : []);
      if (posts.length >= limit) break;
      await page.autoScroll({ times: 1, delayMs: 1200 });
      await page.wait(1);
    }

    if (sawLoginWall && posts.length === 0) {
      throw new AuthRequiredError('linkedin.com', 'LinkedIn timeline requires an active signed-in browser session');
    }

    if (posts.length === 0) {
      throw new EmptyResultError('linkedin timeline', 'Make sure your LinkedIn home feed is visible in the browser.');
    }

    return posts.slice(0, limit).map((post, index) => ({
      rank: index + 1,
      ...post,
    }));
  },
});

export const __test__ = {
  parseMetric,
  buildPostId,
  mergeTimelinePosts,
};
