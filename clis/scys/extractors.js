import { AuthRequiredError, EmptyResultError } from '@jackwener/opencli/errors';
import { cleanText, extractScysArticleMeta, extractScysCourseId, normalizeScysUrl, toScysArticleUrl, toScysCourseUrl, } from './common.js';
import { buildScysTopicLink, formatScysRelativeTime, inferTopicIdFromImageUrls, normalizeOpportunityTab, parseAiSummaryText, stripScysRichText, splitOpportunityFlagsAndTags, } from './opportunity-utils.js';
import { buildScysCourseChapterUrls, normalizeScysCoursePayload, repairScysBrokenUrls, } from './course-utils.js';
const SCYS_DOMAIN = 'scys.com';
const SCYS_TEXT_FIXUPS = [
    [/\bCur\s*or\b/g, 'Cursor'],
    [/\bBu\s*ine\b/g, 'Business'],
    [/\bJava\s*cript\b/g, 'Javascript'],
    [/\bSupaba\s*e\b/g, 'Supabase'],
    [/\bcreen\s*haring\b/gi, 'screensharing'],
    [/\bfa\s*t3d\b/gi, 'fast3d'],
];
async function gotoAndWait(page, url, waitSeconds) {
    await page.goto(url);
    await page.wait(waitSeconds);
}
function pickPreferredScysLink(candidates) {
    const links = Array.from(new Set(candidates
        .map((value) => cleanText(value))
        .filter(Boolean)
        .map((value) => value.replace(/\s+/g, ''))));
    if (links.length === 0)
        return '';
    const detail = links.find((link) => /^https?:\/\/(?:www\.)?scys\.com\/articleDetail\//i.test(link));
    if (detail)
        return detail;
    const internal = links.find((link) => /^https?:\/\/(?:www\.)?scys\.com\//i.test(link));
    if (internal)
        return internal;
    return links[0] ?? '';
}
function parseCnNumberToken(token) {
    const raw = cleanText(token);
    if (!raw)
        return 0;
    const numeric = Number(raw.replace(/[万亿]/g, ''));
    if (!Number.isFinite(numeric))
        return 0;
    if (raw.endsWith('万'))
        return Math.floor(numeric * 10_000);
    if (raw.endsWith('亿'))
        return Math.floor(numeric * 100_000_000);
    return Math.floor(numeric);
}
function parseInteractionCounts(raw) {
    const text = cleanText(raw);
    if (!text)
        return { likes: 0, comments: 0, favorites: 0 };
    const matched = text.match(/[0-9]+(?:\.[0-9]+)?(?:万|亿)?/g) ?? [];
    return {
        likes: parseCnNumberToken(matched[0] ?? ''),
        comments: parseCnNumberToken(matched[1] ?? ''),
        favorites: parseCnNumberToken(matched[2] ?? ''),
    };
}
function buildScysInteractions(like, comments, favorites, fallback) {
    const likeCount = Number(like);
    const commentCount = Number(comments);
    const favoriteCount = Number(favorites);
    if ([likeCount, commentCount, favoriteCount].every((n) => Number.isFinite(n) && n >= 0)) {
        const likes = Math.floor(likeCount);
        const commentsValue = Math.floor(commentCount);
        const favoritesValue = Math.floor(favoriteCount);
        return {
            likes,
            comments: commentsValue,
            favorites: favoritesValue,
            display: `点赞${likes} 评论${commentsValue} 收藏${favoritesValue}`,
        };
    }
    const parsed = parseInteractionCounts(fallback);
    return {
        ...parsed,
        display: `点赞${parsed.likes} 评论${parsed.comments} 收藏${parsed.favorites}`,
    };
}
function trimWithLimit(value, maxLength) {
    const text = polishScysText(value);
    if (!text)
        return '';
    return text.slice(0, maxLength);
}
function polishScysText(value) {
    let text = cleanText(value);
    if (!text)
        return '';
    for (const [pattern, replacement] of SCYS_TEXT_FIXUPS) {
        text = text.replace(pattern, replacement);
    }
    return text;
}
function extractFirstNumber(value) {
    const text = cleanText(value);
    if (!text)
        return 0;
    const match = text.match(/[0-9]+(?:\.[0-9]+)?(?:万|亿)?/);
    if (!match?.[0])
        return 0;
    const raw = match[0];
    const numeric = Number(raw.replace(/[万亿]/g, ''));
    if (!Number.isFinite(numeric))
        return 0;
    if (raw.endsWith('万'))
        return Math.floor(numeric * 10_000);
    if (raw.endsWith('亿'))
        return Math.floor(numeric * 100_000_000);
    return Math.floor(numeric);
}
function isLikelyExternalLink(url) {
    if (!url)
        return false;
    return /^https?:\/\//i.test(url) && !/^https?:\/\/(?:www\.)?scys\.com\//i.test(url);
}
function normalizeMaybeBrokenUrl(raw) {
    return cleanText(raw).replace(/\s+/g, '');
}
function isLikelyFalsePositiveLink(url) {
    const normalized = normalizeMaybeBrokenUrl(url);
    if (!/^https?:\/\//i.test(normalized))
        return false;
    // Heuristic: markdown/autolink-like false positives such as "7.AI" in numbered lists.
    // Example false extraction: http://7.AI
    return /^https?:\/\/\d+\.[a-z]{2,}\/?$/i.test(normalized);
}
function normalizeScysTocRows(rows) {
    const seen = new Set();
    const out = [];
    for (const row of rows ?? []) {
        const entryType = cleanText(row.entry_type || 'chapter');
        const section = cleanText(row.section ?? '');
        const group = cleanText(row.group ?? '');
        const chapterId = cleanText(row.chapter_id ?? '');
        const chapterTitle = cleanText(row.chapter_title ?? '');
        const status = cleanText(row.status ?? '');
        const isCurrent = !!row.is_current;
        if (!section && !group && !chapterTitle && !chapterId)
            continue;
        const key = [
            entryType || 'chapter',
            section,
            group,
            chapterId,
            chapterTitle,
            status,
            isCurrent ? '1' : '0',
        ].join('|');
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push({
            rank: out.length + 1,
            entry_type: entryType === 'section' ? 'section' : 'chapter',
            section,
            group,
            chapter_id: chapterId,
            chapter_title: chapterTitle,
            status,
            is_current: isCurrent,
        });
    }
    return out;
}
async function evaluateScysTocRows(page, opts = {}) {
    const shouldExpand = opts.expandCollapsedSections === true;
    const rows = await page.evaluate(`
    (async () => {
      const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const out = [];
      const seen = new Set();
      const pushRow = (row) => {
        const normalized = {
          entry_type: clean(row.entry_type || 'chapter'),
          section: clean(row.section || ''),
          group: clean(row.group || ''),
          chapter_id: clean(row.chapter_id || ''),
          chapter_title: clean(row.chapter_title || ''),
          status: clean(row.status || ''),
          is_current: !!row.is_current,
        };
        if (!normalized.section && !normalized.group && !normalized.chapter_id && !normalized.chapter_title) return;
        const key = [
          normalized.entry_type || 'chapter',
          normalized.section,
          normalized.group,
          normalized.chapter_id,
          normalized.chapter_title,
          normalized.status,
          normalized.is_current ? '1' : '0',
        ].join('|');
        if (seen.has(key)) return;
        seen.add(key);
        out.push(normalized);
      };

      const chapterSelector = '.vc-chapter-item[data-item-id], .chapter-list .vc-chapter-item, .vc-chapter-item';

      ${shouldExpand ? `
      const expandSections = async () => {
        const sections = Array.from(document.querySelectorAll('.catalogue-section'));
        for (const section of sections) {
          const currentCount = section.querySelectorAll(chapterSelector).length;
          const isExpanded =
            section.classList.contains('expanded') ||
            !!section.querySelector('.vc-section-header.expanded');
          if (currentCount > 0 || isExpanded) continue;

          const sectionTitleEl =
            section.querySelector('.section-title') ||
            section.querySelector('.vc-section-header') ||
            section;

          if (!sectionTitleEl) continue;

          if (typeof sectionTitleEl.click === 'function') {
            sectionTitleEl.click();
          } else {
            sectionTitleEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          }

          for (let i = 0; i < 12; i += 1) {
            await sleep(200);
            const count = section.querySelectorAll(chapterSelector).length;
            const expandedNow =
              section.classList.contains('expanded') ||
              !!section.querySelector('.vc-section-header.expanded');
            if (count > 0 || expandedNow) break;
          }
        }
      };

      await expandSections();
      ` : ''}

      const groups = Array.from(document.querySelectorAll('.vc-chapter-group'));
      const sections = Array.from(document.querySelectorAll('.catalogue-section'));

      if (sections.length > 0) {
        sections.forEach((section) => {
          const sectionTitle = clean(
            section.querySelector('.section-title, .catalogue-section-title, .title')?.textContent || ''
          );
          if (sectionTitle) {
            pushRow({
              entry_type: 'section',
              section: sectionTitle,
              group: sectionTitle,
              chapter_title: sectionTitle,
              chapter_id: '',
              status: '',
              is_current: false,
            });
          }

          const sectionGroups = Array.from(section.querySelectorAll('.vc-chapter-group'));
          if (sectionGroups.length > 0) {
            sectionGroups.forEach((group) => {
              const groupTitle = clean(
                group.querySelector('.group-title, .chapter-group-title, .vc-group-title')?.textContent || ''
              );
              const items = Array.from(group.querySelectorAll(chapterSelector));
              items.forEach((item) => {
                const title = clean(
                  item.querySelector('.chapter-title')?.textContent ||
                  item.querySelector('.chapter-content')?.textContent ||
                  item.textContent ||
                  ''
                );
                const status = clean(item.querySelector('.chapter-status, .chapter-meta')?.textContent || '');
                const cls = item.className || '';
                const isCurrent = /active|current|selected|is-active/.test(cls) || item.getAttribute('aria-current') === 'true';
                if (!title) return;
                pushRow({
                  entry_type: 'chapter',
                  section: sectionTitle,
                  group: groupTitle || sectionTitle,
                  chapter_id: item.getAttribute('data-item-id') || '',
                  chapter_title: title,
                  status,
                  is_current: isCurrent,
                });
              });
            });
          }
        });
      }

      if (out.length === 0 && groups.length > 0) {
        groups.forEach((group) => {
          const groupTitle = clean(
            group.querySelector('.group-title, .chapter-group-title, .vc-group-title')?.textContent || ''
          );
          const sectionTitle = clean(
            group.closest('.catalogue-section')?.querySelector('.section-title, .catalogue-section-title, .title')?.textContent || ''
          );
          const items = Array.from(group.querySelectorAll(chapterSelector));
          items.forEach((item) => {
            const title = clean(
              item.querySelector('.chapter-title')?.textContent ||
              item.querySelector('.chapter-content')?.textContent ||
              item.textContent ||
              ''
            );
            const status = clean(item.querySelector('.chapter-status, .chapter-meta')?.textContent || '');
            const cls = item.className || '';
            const isCurrent = /active|current|selected|is-active/.test(cls) || item.getAttribute('aria-current') === 'true';
            if (!title) return;
            pushRow({
              entry_type: 'chapter',
              section: sectionTitle,
              group: groupTitle,
              chapter_id: item.getAttribute('data-item-id') || '',
              chapter_title: title,
              status,
              is_current: isCurrent,
            });
          });
        });
      }

      if (out.length === 0) {
        const items = Array.from(document.querySelectorAll(chapterSelector));
        items.forEach((item) => {
          const title = clean(
            item.querySelector('.chapter-title')?.textContent ||
            item.querySelector('.chapter-content')?.textContent ||
            item.textContent ||
            ''
          );
          const status = clean(item.querySelector('.chapter-status, .chapter-meta')?.textContent || '');
          const cls = item.className || '';
          const isCurrent = /active|current|selected|is-active/.test(cls) || item.getAttribute('aria-current') === 'true';
          if (!title) return;
          pushRow({
            entry_type: 'chapter',
            section: '',
            group: '',
            chapter_id: item.getAttribute('data-item-id') || '',
            chapter_title: title,
            status,
            is_current: isCurrent,
          });
        });
      }

      return out;
    })()
  `);
    return normalizeScysTocRows(rows);
}
function polishScysCourseSummary(summary, courseId, maxLength) {
    return {
        ...summary,
        course_id: courseId,
        course_title: polishScysText(summary.course_title),
        chapter_title: polishScysText(summary.chapter_title),
        breadcrumb: polishScysText(summary.breadcrumb),
        content: polishScysText(repairScysBrokenUrls(summary.content)).slice(0, maxLength),
        toc_summary: polishScysText(summary.toc_summary),
        updated_at_text: polishScysText(summary.updated_at_text),
        copyright_text: polishScysText(summary.copyright_text),
        prev_chapter: polishScysText(summary.prev_chapter),
        next_chapter: polishScysText(summary.next_chapter),
        discussion_hint: polishScysText(summary.discussion_hint),
        url: summary.url || '',
        raw_url: summary.raw_url || '',
        links: Array.from(new Set((summary.links ?? []).map((link) => cleanText(link)).filter(Boolean))),
        images: Array.from(new Set((summary.images ?? []).map((link) => cleanText(link)).filter(Boolean))),
        content_images: Array.from(new Set((summary.content_images ?? []).map((link) => cleanText(link)).filter(Boolean))),
        image_count: Array.isArray(summary.images) ? summary.images.length : 0,
        content_image_count: Array.isArray(summary.content_images) ? summary.content_images.length : 0,
        image_dir: summary.image_dir || '',
    };
}
async function extractScysCourseSingle(page, inputUrl, opts = {}) {
    const url = toScysCourseUrl(inputUrl);
    const waitSeconds = Math.max(1, Number(opts.waitSeconds ?? 3));
    const maxLength = Math.max(300, Number(opts.maxLength ?? 4000));
    await gotoAndWait(page, url, waitSeconds);
    await ensureScysLogin(page);
    const tocRows = opts.tocRows ?? await evaluateScysTocRows(page);
    const payload = await page.evaluate(`
    (() => {
      const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const normalizeUrl = (value) => clean(value).replace(/\\s+/g, '');
      const abs = (href) => {
        const raw = normalizeUrl(href);
        if (!raw) return '';
        if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
        if (raw.startsWith('//')) return location.protocol + raw;
        if (raw.startsWith('/')) return location.origin + raw;
        return '';
      };
      const uniq = (list) => Array.from(new Set(list.filter(Boolean)));
      const pickFirstText = (selectors) => {
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          const text = clean(el?.textContent || el?.innerText || '');
          if (text) return text;
        }
        return '';
      };
      const pickFirstEl = (selectors) => {
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (el) return el;
        }
        return null;
      };
      const bodyText = clean(document.body?.innerText || '');
      const capture = (matcher) => clean(bodyText.match(matcher)?.[0] || '');

      const contentEl = pickFirstEl([
        '.feishu-doc-content',
        '.document-container',
        '.vc-course-content',
        '.course-content-container',
        '.content-container',
        '.vc-course-main',
      ]);

      const breadcrumbTexts = Array.from(
        document.querySelectorAll(
          '.simple-catalog-toggle .breadcrumb-item, .breadcrumb-item, .breadcrumb a, .breadcrumb span, .vc-breadcrumb a, .vc-breadcrumb span'
        )
      )
        .map((el) => clean(el.textContent || ''))
        .filter(Boolean);

      const chapterItems = Array.from(document.querySelectorAll('.vc-chapter-item[data-item-id], .chapter-list .vc-chapter-item')).map((el) => {
        const item = el;
        const id = clean(item.getAttribute('data-item-id') || '');
        const title = clean(
          item.querySelector('.chapter-title')?.textContent ||
          item.querySelector('.chapter-content')?.textContent ||
          item.textContent ||
          ''
        );
        const cls = item.className || '';
        const isCurrent = /active|current|selected|is-active/.test(cls) || item.getAttribute('aria-current') === 'true';
        return { id, title, isCurrent };
      }).filter((row) => row.title);

      const chapterIdFromQuery = new URL(location.href).searchParams.get('chapterId') || '';
      const chapterId = chapterIdFromQuery || chapterItems.find((item) => item.isCurrent)?.id || '';
      const activeChapterEl =
        document.querySelector('.vc-chapter-item.is-active, .vc-chapter-item.is-current, .vc-chapter-item.active') ||
        null;
      const activeGroupTitle = clean(
        activeChapterEl?.closest('.vc-chapter-group')?.querySelector('.group-title, .chapter-group-title')?.textContent || ''
      );
      const activeSectionTitle = clean(
        activeChapterEl?.closest('.catalogue-section')?.querySelector('.section-title, .catalogue-section-title, .title')?.textContent || ''
      );
      const activeChapterTitle = clean(activeChapterEl?.querySelector('.chapter-title')?.textContent || '');
      const catalogBreadcrumb = [activeSectionTitle, activeGroupTitle, activeChapterTitle].filter(Boolean);

      const courseTitle =
        pickFirstText([
          '.vc-course-main .course-name',
          '.course-name',
          '.vc-course-sidebar .course-title',
          '.course-header .course-title',
          '.course-title',
        ]) ||
        clean((document.title || '').split(' - ')[0] || '');

      const chapterTitleFromContent = pickFirstText([
        '.vc-course-content .content-title',
        '.course-content-container .content-title',
        '.content-title',
        '.current-chapter',
        '.vc-course-main h1',
        'h1',
      ]);

      const allImages = uniq(
        Array.from(document.querySelectorAll('img'))
          .map((img) => abs(img.currentSrc || img.getAttribute('src') || img.getAttribute('data-src') || ''))
      );
      const contentImages = uniq(
        Array.from(contentEl?.querySelectorAll?.('img') || [])
          .map((img) => abs(img.currentSrc || img.getAttribute('src') || img.getAttribute('data-src') || ''))
      );
      const links = uniq(
        Array.from(contentEl?.querySelectorAll?.('a[href]') || [])
          .map((link) => abs(link.getAttribute('href') || ''))
      );

      return {
        courseTitle,
        chapterTitle: chapterTitleFromContent,
        currentChapter:
          chapterItems.find((item) => item.id === chapterId)?.title ||
          chapterItems.find((item) => item.isCurrent)?.title ||
          activeChapterTitle ||
          chapterTitleFromContent,
        breadcrumb: catalogBreadcrumb.length >= 2 ? catalogBreadcrumb : breadcrumbTexts,
        content: clean(contentEl?.innerText || ''),
        chapterId,
        pageUrl: location.href,
        images: allImages,
        contentImages,
        links,
        updatedAtText: capture(/更新于[:：]?\\s*[0-9]{4}[./-][0-9]{2}[./-][0-9]{2}\\s*[0-9]{2}:[0-9]{2}/),
        copyrightText: capture(/版权归[^。！？]{0,120}(?:。|$)/),
        prevChapter: bodyText.includes('上一节') ? '上一节' : '',
        nextChapter: bodyText.includes('下一节') ? '下一节' : '',
        participantText: capture(/\\d+\\s*人参与/),
        discussionHint: bodyText.includes('发起讨论') ? '发起讨论' : (bodyText.includes('讨论区') ? '讨论区' : ''),
      };
    })()
  `);
    if (!payload) {
        throw new EmptyResultError('scys/course', 'Failed to extract course page content');
    }
    const courseId = extractScysCourseId(url);
    const normalized = normalizeScysCoursePayload({
        courseTitle: payload.courseTitle,
        chapterTitle: payload.chapterTitle,
        currentChapter: payload.currentChapter,
        breadcrumb: Array.isArray(payload.breadcrumb) ? payload.breadcrumb : [],
        content: payload.content,
        chapterId: payload.chapterId,
        pageUrl: String(payload.pageUrl || url),
        images: Array.isArray(payload.images) ? payload.images : [],
        contentImages: Array.isArray(payload.contentImages) ? payload.contentImages : [],
        links: Array.isArray(payload.links) ? payload.links : [],
        tocRows,
        updatedAtText: payload.updatedAtText,
        copyrightText: payload.copyrightText,
        prevChapter: payload.prevChapter,
        nextChapter: payload.nextChapter,
        discussionHint: payload.discussionHint,
        participantText: payload.participantText,
    });
    const result = polishScysCourseSummary({
        ...normalized,
        url: normalized.url || normalizeScysUrl(url),
        raw_url: normalized.raw_url || normalizeScysUrl(url),
    }, courseId, maxLength);
    if (!result.content && tocRows.length === 0) {
        throw new EmptyResultError('scys/course', 'No course content or table of contents was detected');
    }
    return result;
}
export async function ensureScysFeedReady(page) {
    await page.evaluate(`
    (async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let i = 0; i < 12; i += 1) {
        const hasCards = document.querySelectorAll('.post-list-container .compact-card, .compact-card').length > 0;
        const hasControls = document.querySelector('.vc-secondary-filter .filter-item, .titles.selector .button, .select.wrap .button');
        if (hasCards || hasControls) return;
        await sleep(250);
      }
    })()
  `);
}
export async function ensureScysLogin(page) {
    const state = await page.evaluate(`
    (() => {
      const text = (document.body?.innerText || '').slice(0, 12000);
      const strongLoginText = /扫码登录|手机号登录|验证码登录|微信登录|账号登录|登录\\/注册/.test(text);
      const genericLoginText = /请登录|登录后/.test(text);
      const loginCtaText = /立即登录|去登录|重新登录|登录查看|登录后查看|登录可见|请先登录/.test(text);
      const loginByDom = !!document.querySelector(
        '.login-container, .login-box, .qrcode-login, .login-btn, .btn-login, .auth-mask, .auth-dialog, form[action*="login"], input[type="password"], input[type="tel"][placeholder*="手机号"], button[class*="login"], a[href*="login"]'
      );
      const hasContentSignals = !!document.querySelector(
        '.course-detail-page, .vc-course-main, .post-list-container, .compact-card, .activity-left, .week-card, .vc-secondary-filter'
      );
      const routeLooksLikeLogin = location.pathname.includes('/login');
      return { strongLoginText, genericLoginText, loginCtaText, loginByDom, hasContentSignals, routeLooksLikeLogin };
    })()
  `);
    if (!state)
        return;
    const shouldBlock = !!state.routeLooksLikeLogin
        || !!state.loginByDom
        || (!!state.loginCtaText && !state.hasContentSignals)
        || (!!state.strongLoginText && !state.hasContentSignals)
        || (!!state.genericLoginText && !state.hasContentSignals);
    if (shouldBlock) {
        throw new AuthRequiredError(SCYS_DOMAIN, 'SCYS content requires a logged-in browser session');
    }
}
export async function extractScysCourse(page, inputUrl, opts = {}) {
    return extractScysCourseSingle(page, inputUrl, opts);
}
export async function extractScysCourseAll(page, inputUrl, opts = {}) {
    const tocRows = await extractScysToc(page, inputUrl, opts);
    const urls = buildScysCourseChapterUrls(inputUrl, tocRows);
    if (urls.length === 0) {
        throw new EmptyResultError('scys/course', 'No chapter ids were detected for deterministic full-course export');
    }
    const out = [];
    for (const url of urls) {
        out.push(await extractScysCourseSingle(page, url, { ...opts, tocRows }));
    }
    return out;
}
export async function extractScysToc(page, courseInput, opts = {}) {
    const url = toScysCourseUrl(courseInput);
    const waitSeconds = Math.max(1, Number(opts.waitSeconds ?? 2));
    await gotoAndWait(page, url, waitSeconds);
    await ensureScysLogin(page);
    const normalized = await evaluateScysTocRows(page, { expandCollapsedSections: true });
    if (normalized.length === 0) {
        await ensureScysLogin(page);
        throw new EmptyResultError('scys/toc', 'No chapter list was detected on this course page. If your SCYS browser session expired, reopen scys.com in Chrome, log in again, then retry.');
    }
    return normalized;
}
export async function extractScysArticle(page, inputUrl, opts = {}) {
    const url = toScysArticleUrl(inputUrl);
    const waitSeconds = Math.max(1, Number(opts.waitSeconds ?? 5));
    const maxLength = Math.max(300, Number(opts.maxLength ?? 4000));
    const fromUrl = extractScysArticleMeta(url);
    await gotoAndWait(page, url, waitSeconds);
    await ensureScysLogin(page);
    const payload = await page.evaluate(`
    (() => {
      const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const normalizeUrl = (value) => clean(value).replace(/\\s+/g, '');
      const abs = (href) => {
        const raw = normalizeUrl(href);
        if (!raw) return '';
        if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
        if (raw.startsWith('/')) return location.origin + raw;
        return '';
      };
      const uniq = (list) => Array.from(new Set(list.filter(Boolean)));
      const pickText = (selectors) => {
        for (const selector of selectors) {
          const text = clean(document.querySelector(selector)?.textContent || '');
          if (text) return text;
        }
        return '';
      };

      const articleMatch = location.pathname.match(/^\\/articleDetail\\/([^/]+)\\/([^/]+)/);
      const entityType = clean(articleMatch?.[1] || '');
      const topicId = clean(articleMatch?.[2] || '');

      const title = pickText([
        '.title-line .post-title',
        '.post-title',
        '.article-title',
        '.topic-title',
        'h1',
      ]) || clean(document.title || '');
      const author = pickText([
        '.post-item-top-right .name',
        '.post-item-top .name',
        '.post-item-top-right .user-name',
        '.post-item-top .user-name',
      ]);
      const time = pickText([
        '.post-item-top-right .date',
        '.post-item-top .date',
        '.post-item-top-right .time',
        '.post-item-top .time',
      ]);

      const content = pickText([
        '.post-content',
        '.content-container .post-content',
        '.content-container',
      ]);
      const aiSummary = pickText([
        '.ai-summary-container .content',
        '.ai-summary-container .content-stream',
        '.ai-summary-container',
      ]);

      const flags = uniq(
        Array.from(document.querySelectorAll('.title-line .icon, .title-line .tag, .title-line .flag'))
          .map((el) => clean(el.textContent || ''))
      );
      const tags = uniq(
        Array.from(document.querySelectorAll('.label-box .tag-item, .tag-label-box .tag-item, .label-box .tag'))
          .map((el) => clean(el.textContent || ''))
      );

      const interactionNodes = Array.from(
        document.querySelectorAll('.interactions .item, .interactions .favorite-wrapper, .interactions .favorite-wrapper .item')
      ).map((el) => ({
        cls: (el.className || '').toString(),
        text: clean(el.textContent || ''),
      }));

      const likeText = clean(document.querySelector('.interactions .like-item')?.textContent || '');
      const favoriteText = clean(
        document.querySelector('.interactions .favorite-wrapper .item')?.textContent ||
        document.querySelector('.interactions .favorite-wrapper')?.textContent ||
        ''
      );
      const commentText = clean(
        interactionNodes.find((node) => /item/.test(node.cls) && !/like/.test(node.cls) && /^[0-9]/.test(node.text))?.text || ''
      );

      const imageCandidates = Array.from(
        document.querySelectorAll('.image-list-container img, .arco-carousel img, .post-content img, .content-container img')
      )
        .map((img) => abs(img.getAttribute('src') || img.getAttribute('data-src') || ''))
        .map((src) => normalizeUrl(src))
        .filter(Boolean)
        .filter((src) => !src.startsWith('data:'))
        .filter((src) => !src.includes('/upload/avatar/'))
        .filter((src) => !src.includes('/images/img_bg_empty'))
        .filter((src) => /\\/xq\\/images\\/|\\.(jpg|jpeg|png|webp|gif)(\\?|$)/i.test(src));
      const images = uniq(imageCandidates);

      const sourceLinks = uniq(
        Array.from(document.querySelectorAll('.post-content a[href], .content-container a[href]'))
          .map((a) => abs(a.getAttribute('href') || ''))
          .map((href) => normalizeUrl(href))
      );
      const externalLinks = sourceLinks.filter((href) => /^https?:\\/\\//i.test(href) && !/^https?:\\/\\/(?:www\\.)?scys\\.com\\//i.test(href));

      return {
        entityType,
        topicId,
        title,
        author,
        time,
        flags,
        tags,
        content,
        aiSummary,
        likeText,
        commentText,
        favoriteText,
        images,
        sourceLinks,
        externalLinks,
        pageUrl: location.href,
      };
    })()
  `);
    if (!payload) {
        throw new EmptyResultError('scys/article', 'Failed to extract article detail page');
    }
    const rawFlags = (payload.flags ?? []).map((value) => polishScysText(value)).filter(Boolean);
    const rawTags = (payload.tags ?? []).map((value) => polishScysText(value)).filter(Boolean);
    const split = splitOpportunityFlagsAndTags([...rawFlags, ...rawTags]);
    const flags = Array.from(new Set([
        ...rawFlags,
        ...split.flags.map((value) => polishScysText(value)).filter(Boolean),
    ]));
    const tags = Array.from(new Set([
        ...rawTags,
        ...split.tags.map((value) => polishScysText(value)).filter(Boolean),
    ])).filter((tag) => !flags.includes(tag));
    const interactions = buildScysInteractions(extractFirstNumber(payload.likeText), extractFirstNumber(payload.commentText), extractFirstNumber(payload.favoriteText));
    const sourceLinks = Array.from(new Set((payload.sourceLinks ?? [])
        .map((href) => normalizeMaybeBrokenUrl(href))
        .filter(Boolean)
        .filter((href) => !isLikelyFalsePositiveLink(href))));
    const externalLinks = Array.from(new Set((payload.externalLinks ?? [])
        .map((href) => normalizeMaybeBrokenUrl(href))
        .filter(isLikelyExternalLink)
        .filter((href) => !isLikelyFalsePositiveLink(href))));
    const images = Array.from(new Set((payload.images ?? []).map((src) => normalizeMaybeBrokenUrl(src)).filter(Boolean)));
    const content = polishScysText(stripScysRichText(payload.content ?? '')).slice(0, maxLength);
    const aiSummary = polishScysText(stripScysRichText(payload.aiSummary ?? '')).slice(0, maxLength);
    const title = polishScysText(payload.title ?? '');
    const author = polishScysText(payload.author ?? '');
    if (!title && !content && !aiSummary) {
        throw new EmptyResultError('scys/article', 'No title/content was detected on this article page');
    }
    return {
        entity_type: polishScysText(payload.entityType || fromUrl.entityType),
        topic_id: polishScysText(payload.topicId || fromUrl.topicId),
        url: normalizeScysUrl(payload.pageUrl || url),
        title,
        author,
        time: polishScysText(payload.time ?? ''),
        tags,
        flags,
        content,
        ai_summary: aiSummary,
        interactions,
        image_count: images.length,
        images,
        external_link_count: externalLinks.length,
        external_links: externalLinks,
        source_links: sourceLinks,
        raw_url: normalizeScysUrl(payload.pageUrl || url),
    };
}
export async function extractScysFeed(page, inputUrl, opts = {}) {
    const url = normalizeScysUrl(inputUrl);
    const waitSeconds = Math.max(1, Number(opts.waitSeconds ?? 3));
    const limit = Math.max(1, Number(opts.limit ?? 20));
    const maxLength = Math.max(120, Number(opts.maxLength ?? 600));
    await gotoAndWait(page, url, waitSeconds);
    await ensureScysLogin(page);
    await ensureScysFeedReady(page);
    // API-first extraction:
    // feed pages use /shengcai-web/client/homePage/searchTopic as list source.
    await page.installInterceptor('shengcai-web/client');
    await page.evaluate(`
    (async () => {
      const clean = (v) => (v || '').replace(/\\s+/g, ' ').trim();
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const isActive = (el) => /active|is-active|selected/.test(el?.className || '');

      const search = new URL(location.href).searchParams;
      const expectedFilter = (search.get('filter') || '').toLowerCase();

      const homeFilters = Array.from(document.querySelectorAll('.vc-secondary-filter .filter-item'));
      if (homeFilters.length > 0) {
        const targetLabel = expectedFilter === 'essence' ? '精华' : '全部';
        const target = homeFilters.find((el) => clean(el.textContent || '') === targetLabel) || homeFilters[0];
        const active = homeFilters.find((el) => isActive(el));
        const alt = homeFilters.find((el) => el !== target);
        if (active && target && active === target && alt) {
          alt.click();
          await sleep(900);
        }
        if (target) {
          target.click();
          await sleep(1200);
        }
      }

      const profileTabs = Array.from(document.querySelectorAll('.titles.selector .button, .select.wrap .button, .button'))
        .filter((el) => ['帖子', '收藏'].includes(clean(el.textContent || '')));
      if (profileTabs.length > 0) {
        const posts = profileTabs.find((el) => clean(el.textContent || '') === '帖子') || profileTabs[0];
        const alt = profileTabs.find((el) => el !== posts);
        if (posts && isActive(posts) && alt) {
          alt.click();
          await sleep(1000);
        }
        if (posts) {
          posts.click();
          await sleep(1200);
        }
      }

      window.scrollTo(0, document.body.scrollHeight);
      await sleep(800);
      window.scrollTo(0, 0);
      await sleep(300);
    })()
  `);
    const intercepted = await page.getInterceptedRequests();
    const latest = intercepted
        .filter((entry) => {
        const data = entry?.data;
        return data && Array.isArray(data.items) && data.items.some((item) => item?.topicDTO);
    })
        .at(-1);
    let normalized = [];
    if (latest?.data?.items?.length) {
        normalized = latest.data.items.slice(0, limit).map((item, index) => {
            const topic = item?.topicDTO ?? {};
            const user = item?.topicUserDTO ?? {};
            const menuValues = Array.isArray(topic.menuList)
                ? topic.menuList.map((m) => cleanText(m?.value)).filter(Boolean)
                : [];
            const tags = Array.from(new Set(menuValues.map((v) => polishScysText(v)).filter(Boolean)));
            const topicId = cleanText(topic.topicId || topic.entityId);
            const entityType = cleanText(topic.entityType || 'xq_topic');
            const url = pickPreferredScysLink([
                item?.detailUrl,
                buildScysTopicLink(entityType, topicId),
                topic?.externalLink,
            ]);
            const images = Array.isArray(topic.imageList)
                ? topic.imageList.map((u) => cleanText(u)).filter(Boolean)
                : [];
            const interactions = buildScysInteractions(topic.likeCount, topic.commentsCount, topic.favoriteCount);
            const flags = topic.isDigested ? ['精华'] : [];
            const summary = trimWithLimit(stripScysRichText(topic.articleContent), maxLength);
            return {
                rank: index + 1,
                author: polishScysText(user.name),
                time: formatScysRelativeTime(topic.gmtCreate),
                flags,
                title: polishScysText(stripScysRichText(topic.showTitle)),
                summary,
                tags,
                interactions,
                interactions_display: interactions.display,
                url,
                raw_url: url,
                images,
                image_count: images.length,
            };
        }).filter((row) => row.title || row.summary);
    }
    // DOM fallback for cases where interceptor is blocked or request timing misses.
    if (normalized.length === 0) {
        await page.autoScroll({ times: 2, delayMs: 1200 });
        const rows = await page.evaluate(`
      (() => {
        const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
        const abs = (href) => {
          if (!href) return '';
          if (href.startsWith('http://') || href.startsWith('https://')) return href;
          if (href.startsWith('/')) return location.origin + href;
          return '';
        };

        const cards = Array.from(document.querySelectorAll('.post-list-container .compact-card, .compact-card'));
        return cards.map((card) => {
          const userLine = clean(card.querySelector('.user-line')?.textContent || '');
          const author = clean(
            card.querySelector('.user-line .user-name, .avatar-group .user-name, .author-name')?.textContent || ''
          );
          const time = clean(card.querySelector('.user-line .time-label, .user-line .time')?.textContent || '');
          const badge = clean(card.querySelector('.vc-essence-badge, .badge')?.textContent || '');
          const title = clean(card.querySelector('.title-text, .title-line .title, .title-line')?.textContent || '');
          const preview = clean(card.querySelector('.content-preview, .preview, .content')?.textContent || '');
          const tags = Array.from(card.querySelectorAll('.tags .tag, .tags span, .tag-list .tag'))
            .map((el) => clean(el.textContent || ''))
            .filter(Boolean);
          const interactions = clean(card.querySelector('.compact-interactions, .interactions')?.textContent || '');
          const metaLine = clean(card.querySelector('.meta-line')?.textContent || '');
          const links = Array.from(card.querySelectorAll('a[href]'))
            .map((el) => abs(el.getAttribute('href') || ''))
            .filter(Boolean);

          return {
            author,
            time,
            user_line: userLine,
            badge,
            title,
            preview,
            tags,
            interactions,
            meta_line: metaLine,
            links,
          };
        }).filter((item) => item.title || item.preview);
      })()
    `);
        normalized = (rows ?? []).slice(0, limit).map((row, index) => {
            const userLine = cleanText(row.user_line ?? '')
                .replace(/复制链接|跳转星球|投诉建议/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            const [authorByLine, timeByLine] = userLine.split('·').map((part) => cleanText(part));
            const tags = Array.from(new Set((row.tags ?? []).map((tag) => polishScysText(tag)).filter(Boolean)));
            const flags = row.badge ? [polishScysText(row.badge)] : [];
            const summary = trimWithLimit(row.preview ?? '', maxLength);
            const interactions = buildScysInteractions(undefined, undefined, undefined, row.interactions || row.meta_line);
            const url = pickPreferredScysLink(row.links ?? []);
            return {
                rank: index + 1,
                author: polishScysText(row.author ?? authorByLine),
                time: cleanText(row.time ?? timeByLine),
                flags,
                title: polishScysText(row.title ?? '').replace(/^(精华|热门)\s*/, ''),
                summary,
                tags,
                interactions,
                interactions_display: interactions.display,
                url,
                raw_url: url,
                images: [],
                image_count: 0,
            };
        }).filter((row) => row.title || row.summary);
    }
    if (normalized.length === 0) {
        throw new EmptyResultError('scys/feed', 'No feed cards were detected on this page');
    }
    return normalized;
}
export async function extractScysOpportunity(page, inputUrl, opts = {}) {
    const url = normalizeScysUrl(inputUrl);
    const waitSeconds = Math.max(1, Number(opts.waitSeconds ?? 3));
    const limit = Math.max(1, Number(opts.limit ?? 20));
    const tab = normalizeOpportunityTab(opts.tab);
    await gotoAndWait(page, url, waitSeconds);
    await ensureScysLogin(page);
    // API-first extraction. The page internally requests:
    //   /shengcai-web/client/homePage/searchTopic
    // We intercept this payload to get stable fields (time, tags, images, topic ids).
    await page.installInterceptor('shengcai-web/client/homePage/searchTopic');
    await page.evaluate(`
    (async () => {
      const clean = (v) => (v || '').replace(/\\s+/g, ' ').trim();
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const target = ${JSON.stringify(tab.label)};
      const filters = Array.from(document.querySelectorAll('.vc-secondary-filter .filter-item'));
      const hit = filters.find((el) => clean(el.textContent || '') === target);
      const active = filters.find((el) => (el.className || '').includes('active'));
      const alt = filters.find((el) => el !== hit);

      // Trigger request even when the current tab is already active:
      // switch away once, then switch back to target.
      if (active && hit && active === hit && alt) {
        alt.click();
        await sleep(1000);
      }

      if (hit) {
        hit.click();
      } else if (filters.length > 0) {
        filters[0].click();
      }

      await sleep(1400);
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(800);
    })()
  `);
    const intercepted = await page.getInterceptedRequests();
    const latest = intercepted
        .filter((entry) => {
        const data = entry?.data;
        return data && Array.isArray(data.items) && data.items.length > 0;
    })
        .at(-1);
    let normalized = [];
    if (latest?.data?.items?.length) {
        normalized = latest.data.items.slice(0, limit).map((item, index) => {
            const topic = item?.topicDTO ?? {};
            const user = item?.topicUserDTO ?? {};
            const menuValues = Array.isArray(topic.menuList)
                ? topic.menuList.map((m) => cleanText(m?.value)).filter(Boolean)
                : [];
            const { flags, tags } = splitOpportunityFlagsAndTags(menuValues);
            const interactions = buildScysInteractions(topic.likeCount, topic.commentsCount, topic.favoriteCount);
            const entityType = cleanText(topic.entityType);
            const topicId = cleanText(topic.topicId || topic.entityId);
            const images = Array.isArray(topic.imageList)
                ? topic.imageList.map((u) => cleanText(u)).filter(Boolean)
                : [];
            const url = cleanText(item.detailUrl) || buildScysTopicLink(entityType, topicId);
            const normalizedFlags = flags.map((f) => polishScysText(f)).filter(Boolean);
            const normalizedTags = tags.map((t) => polishScysText(t)).filter(Boolean);
            const summary = polishScysText(stripScysRichText(topic.articleContent));
            return {
                rank: index + 1,
                author: polishScysText(user.name),
                time: formatScysRelativeTime(topic.gmtCreate),
                flags: normalizedFlags,
                title: polishScysText(stripScysRichText(topic.showTitle)),
                summary,
                ai_summary: polishScysText(parseAiSummaryText(topic.aiSummaryContent)),
                tags: normalizedTags,
                interactions,
                interactions_display: interactions.display,
                url,
                raw_url: url,
                topic_id: topicId,
                entity_type: entityType,
                images,
                image_count: images.length,
            };
        });
    }
    // DOM fallback: keep the previous extractor as backup when the API payload is blocked.
    if (normalized.length === 0) {
        await page.autoScroll({ times: 2, delayMs: 1200 });
        const rows = await page.evaluate(`
      (() => {
        const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
        const abs = (href) => {
          if (!href) return '';
          if (href.startsWith('http://') || href.startsWith('https://')) return href;
          if (href.startsWith('/')) return location.origin + href;
          return '';
        };
        const cards = Array.from(document.querySelectorAll('.post-list-container .post-item, .post-item'));
        return cards.map((card) => {
          const top = card.querySelector('.post-item-top') || card;
          const author = clean(top.querySelector('.name, .author, .nickname, .user-name')?.textContent || '');
          const time = clean(top.querySelector('.date, .time, .meta-time')?.textContent || '');
          const flags = Array.from(card.querySelectorAll('.hit-icon, .icon, .post-title .tag, .post-title .flag'))
            .map((el) => clean(el.textContent || ''))
            .filter(Boolean);
          const title = clean(card.querySelector('.post-title, .title-line')?.textContent || '');
          const content = clean(card.querySelector('.content-stream, .post-content, .content-preview')?.textContent || '');
          const aiSummary = clean(card.querySelector('.ai-summary-container .content, .ai-summary-container, .ai-summary')?.textContent || '');
          const tags = Array.from(card.querySelectorAll('.label-box .tag-item, .label-box span, .tags .tag'))
            .map((el) => clean(el.textContent || ''))
            .filter(Boolean);
          const interactions = clean(card.querySelector('.interactions, .compact-interactions')?.textContent || '');
          const images = Array.from(card.querySelectorAll('.image-list img, img.multi-img'))
            .map((img) => clean(img.getAttribute('src') || img.getAttribute('data-src') || ''))
            .filter(Boolean);
          const link = abs(card.querySelector('a[href]')?.getAttribute('href') || '');
          return { author, time, flags, title, content, ai_summary: aiSummary, tags, interactions, link, image_urls: images };
        }).filter((item) => item.title || item.content);
      })()
    `);
        normalized = (rows ?? []).slice(0, limit).map((row, index) => {
            const images = (row.image_urls ?? []).map((u) => cleanText(u)).filter(Boolean);
            const topicId = inferTopicIdFromImageUrls(images);
            const tags = Array.from(new Set((row.tags ?? []).map((tag) => cleanText(tag)).filter(Boolean)));
            const interactions = buildScysInteractions(undefined, undefined, undefined, row.interactions ?? '');
            const summary = polishScysText(stripScysRichText(row.content ?? ''));
            const url = cleanText(row.link ?? '') || buildScysTopicLink('xq_topic', topicId);
            const normalizedFlags = (row.flags ?? []).map((f) => polishScysText(f)).filter(Boolean);
            return {
                rank: index + 1,
                author: polishScysText(row.author ?? ''),
                time: cleanText(row.time ?? ''),
                flags: normalizedFlags,
                title: polishScysText(stripScysRichText(row.title ?? '')),
                summary,
                ai_summary: polishScysText(stripScysRichText(row.ai_summary ?? '')),
                tags: tags.map((tag) => polishScysText(tag)).filter(Boolean),
                interactions,
                interactions_display: interactions.display,
                url,
                raw_url: url,
                topic_id: topicId,
                entity_type: topicId ? 'xq_topic' : '',
                images,
                image_count: images.length,
            };
        });
    }
    if (normalized.length === 0) {
        throw new EmptyResultError('scys/opportunity', 'No opportunity cards were detected on this page');
    }
    return normalized;
}
export async function extractScysActivity(page, inputUrl, opts = {}) {
    const url = normalizeScysUrl(inputUrl);
    const waitSeconds = Math.max(1, Number(opts.waitSeconds ?? 3));
    await gotoAndWait(page, url, waitSeconds);
    await ensureScysLogin(page);
    const payload = await page.evaluate(`
    (async () => {
      const clean = (value) => (value || '').replace(/\s+/g, ' ').trim();
      const normalizeTab = (value) => clean(value).replace(/\s*New$/i, '').trim();
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

      const contentTabs = Array.from(document.querySelectorAll('.activity-left .container.v-no-scrollbar span, .container.v-no-scrollbar span'))
        .filter((el) => clean(el.textContent || ''));
      const roadmapTab = contentTabs.find((el) => clean(el.textContent || '').includes('航线图'));
      if (roadmapTab && typeof roadmapTab.click === 'function') {
        roadmapTab.click();
        await sleep(500);
      }

      const title = clean(
        document.querySelector('.activity-left .name, h1, .activity-title, .landing-title')?.textContent ||
        document.title ||
        ''
      );
      const subtitle = clean(
        document.querySelector('.activity-left .des, .subtitle, .sub-title, .activity-subtitle, .landing-subtitle')?.textContent ||
        ''
      );

      const tabGroups = Array.from(
        document.querySelectorAll('.activity-left .tabs, .activity-left .container.v-no-scrollbar, .tabs')
      )
        .map((group) =>
          Array.from(group.querySelectorAll('.tab-item, .tab, [role="tab"], .item, span'))
            .map((el) => normalizeTab(el.textContent || ''))
            .filter(Boolean)
        )
        .filter((group) => group.length > 0);
      const tabsRaw =
        tabGroups.find((group) => group.some((text) => /简介|航线图|问答/.test(text))) ||
        tabGroups[0] ||
        [];
      const tabs = Array.from(new Set(tabsRaw));

      const stageEls = Array.from(
        document.querySelectorAll('.activity-line-content .week-card, .activity-left .week-card, .week-card')
      );
      const stages = stageEls.map((stage) => {
        const phaseTitle = clean(stage.querySelector('.title-name, .stage-name')?.textContent || '');
        const stageTitleRaw = clean(stage.querySelector('.title-week .text, .title-week, .week-title, .stage-title')?.textContent || '');
        const duration = clean(
          stage.querySelector('.title-week .highlightInActivity, .duration, .time, .date-range, .stage-duration')?.textContent || ''
        );
        const stageTitle = clean(
          [phaseTitle, stageTitleRaw.replace(duration, '').trim()]
            .map((v) => clean(v))
            .filter(Boolean)
            .join(' ')
        );
        const tasks = Array.from(stage.querySelectorAll('.card .row, .row'))
          .map((row) => {
            const key = clean(row.querySelector('.key')?.textContent || '');
            const text = clean(row.querySelector('.card-title')?.textContent || row.textContent || '');
            if (!text) return '';
            if (key && !text.startsWith(key)) return key + '. ' + text;
            return text;
          })
          .filter(Boolean);
        return { title: stageTitle, duration, tasks };
      }).filter((stage) => stage.title || stage.tasks.length > 0);

      return {
        title,
        subtitle,
        tabs,
        stages,
        url: location.href,
      };
    })()
  `);
    if (!payload) {
        throw new EmptyResultError('scys/activity', 'Failed to extract activity page content');
    }
    if (!payload.title && (!payload.stages || payload.stages.length === 0)) {
        throw new EmptyResultError('scys/activity', 'No activity title or stages were detected');
    }
    return {
        title: polishScysText(payload.title),
        subtitle: polishScysText(payload.subtitle),
        tabs: (payload.tabs ?? []).map((tab) => polishScysText(tab)).filter(Boolean),
        stages: (payload.stages ?? []).map((stage) => ({
            title: polishScysText(stage.title),
            duration: polishScysText(stage.duration),
            tasks: (stage.tasks ?? []).map((task) => polishScysText(task)).filter(Boolean),
        })),
        url: normalizeScysUrl(payload.url || url),
    };
}
