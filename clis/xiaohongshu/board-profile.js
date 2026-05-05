import { cli, Strategy } from '@jackwener/opencli/registry';
import { extractXhsUserNotes, normalizeXhsUserId } from './user-helpers.js';

const DEFAULT_HOME_URL = process.env.OPENCLI_XHS_USER_HOME_URL?.trim() || 'https://www.xiaohongshu.com/explore';
const DEFAULT_HOME_WAIT_SECONDS = Math.max(0, Number(process.env.OPENCLI_XHS_USER_HOME_WAIT_SECONDS ?? 6));
const DEFAULT_BOARD_WAIT_SECONDS = Math.max(0, Number(process.env.OPENCLI_XHS_BOARD_WAIT_SECONDS ?? 3));
const DEFAULT_PROFILE_WAIT_SECONDS = Math.max(0, Number(process.env.OPENCLI_XHS_BOARD_PROFILE_WAIT_SECONDS ?? 3));

function toNonNegativeNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeXhsUrl(value, fallback) {
    const raw = String(value || fallback).trim();
    try {
        const url = new URL(raw);
        if (!url.hostname.endsWith('xiaohongshu.com')) {
            return fallback;
        }
        return url.toString();
    }
    catch {
        return fallback;
    }
}

function parseBoardTarget(value) {
    const fallback = 'https://www.xiaohongshu.com/explore';
    const raw = String(value || '').trim();
    const url = new URL(raw || fallback);
    const hash = url.hash.replace(/^#/, '');
    url.hash = '';

    const params = new URLSearchParams(hash);
    const rawIndex = params.get('card') ?? params.get('index') ?? (/^\d+$/.test(hash) ? hash : '0');
    const cardIndex = Math.max(0, Number.parseInt(rawIndex || '0', 10) || 0);

    return {
        boardUrl: normalizeXhsUrl(url.toString(), fallback),
        cardIndex,
    };
}

async function readUserSnapshot(page) {
    return await page.evaluate(`
    (() => {
      const safeClone = (value) => {
        try {
          return JSON.parse(JSON.stringify(value ?? null));
        } catch {
          return null;
        }
      };

      const userStore = window.__INITIAL_STATE__?.user || {};
      return {
        noteGroups: safeClone(userStore.notes?._value || userStore.notes || []),
        pageData: safeClone(userStore.userPageData?._value || userStore.userPageData || {}),
      };
    })()
  `);
}

function clickBoardCardScript(cardIndex) {
    return `
    (() => {
      const cardIndex = ${JSON.stringify(cardIndex)};
      const seen = new Set();
      const candidates = [];
      const isVisible = (el) => {
        const rect = el?.getBoundingClientRect?.();
        return !!rect && rect.width >= 40 && rect.height >= 40;
      };
      const addCandidate = (el) => {
        if (!el || seen.has(el) || !isVisible(el)) return;
        seen.add(el);
        candidates.push(el);
      };

      document.querySelectorAll('section.note-item, .note-item').forEach((card) => {
        addCandidate(
          card.querySelector('a.cover, a[href*="/explore/"], a[href*="/search_result/"], a[href*="/discovery/item/"], img') || card
        );
      });

      document
        .querySelectorAll('a[href*="/explore/"], a[href*="/search_result/"], a[href*="/discovery/item/"], a[href*="/note/"]')
        .forEach((link) => addCandidate(link.querySelector('img') || link));

      document.querySelectorAll('img').forEach((image) => {
        const noteContainer = image.closest('section.note-item, .note-item, a[href*="/explore/"], a[href*="/search_result/"], a[href*="/discovery/item/"], a[href*="/note/"]');
        if (noteContainer) addCandidate(image);
      });

      const target = candidates[cardIndex];
      if (!target) {
        return { ok: false, available: candidates.length, href: location.href };
      }

      target.scrollIntoView({ block: 'center', inline: 'center' });
      target.click();
      return {
        ok: true,
        available: candidates.length,
        href: location.href,
        tag: target.tagName,
        text: (target.textContent || target.alt || '').replace(/\\s+/g, ' ').trim().slice(0, 80),
      };
    })()
  `;
}

async function clickBoardCard(page, cardIndex) {
    let lastResult = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
        lastResult = await page.evaluate(clickBoardCardScript(cardIndex));
        if (lastResult?.ok) {
            return lastResult;
        }

        await page.autoScroll({ times: 1, delayMs: 1200 });
        await page.wait({ time: 1 + Math.random() });
    }

    throw new Error(`Board card ${cardIndex + 1} was not found or clickable. Available cards: ${lastResult?.available ?? 0}.`);
}

async function clickAuthorAvatar(page) {
    const target = await page.evaluate(`
    (() => {
      const ignoredArea = '.comment, .comments, .comment-item, .comment-list';
      const isVisible = (el) => {
        if (!el) return null;
        const rect = el.getBoundingClientRect?.();
        if (!rect || rect.width < 8 || rect.height < 8) return null;
        const style = window.getComputedStyle?.(el);
        if (style && (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)) {
          return null;
        }
        return rect;
      };
      const readTarget = (el, selector, rank) => {
        if (!el || el.closest(ignoredArea)) return null;
        const profileLink = el.matches?.('a[href*="/user/profile/"]')
          ? el
          : el.closest?.('a[href*="/user/profile/"]');
        const clickTarget = profileLink || el.closest?.('.avatar-click, .avatar-container, .username, button, [role="button"], a') || el;
        if (profileLink) {
          profileLink.setAttribute('target', '_self');
        }
        const rect = isVisible(clickTarget) || isVisible(el);
        if (!rect) return null;
        clickTarget.scrollIntoView({ block: 'center', inline: 'center' });
        const nextRect = isVisible(clickTarget) || isVisible(el) || rect;
        if (!nextRect || nextRect.width <= 0 || nextRect.height <= 0) return null;
        const href = profileLink?.href || clickTarget.closest?.('a[href*="/user/profile/"]')?.href || '';
        if (!href && selector.includes('href')) return null;
        return {
          ok: true,
          selector,
          rank,
          href,
          text: (clickTarget.textContent || el.alt || '').replace(/\\s+/g, ' ').trim().slice(0, 80),
          x: nextRect.left + nextRect.width / 2,
          y: nextRect.top + nextRect.height / 2,
        };
      };
      const collectCandidates = () => {
        const candidates = [];
        const pushAll = (selector, rank) => {
          document.querySelectorAll(selector).forEach((el) => {
            const candidate = readTarget(el, selector, rank);
            if (candidate) candidates.push(candidate);
          });
        };

        pushAll('#noteContainer a[href*="/user/profile/"]', 0);
        pushAll('a[href*="/user/profile/"]', 1);
        pushAll('#noteContainer .avatar-click, #noteContainer .avatar-container, #noteContainer .username', 2);
        pushAll('.avatar-click, .avatar-container, .username', 3);

        return candidates.sort((a, b) => {
          if (a.rank !== b.rank) return a.rank - b.rank;
          if (!!b.href !== !!a.href) return Number(!!b.href) - Number(!!a.href);
          return a.y - b.y || a.x - b.x;
        });
      };

      const candidate = collectCandidates()[0];
      if (candidate) return candidate;

      return {
        ok: false,
        href: location.href,
        text: (document.body?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 300),
      };
    })()
  `);

    if (!target?.ok) {
        throw new Error('Could not click the author avatar from the board note detail page.');
    }

    if (typeof page.nativeClick === 'function' && Number.isFinite(target.x) && Number.isFinite(target.y)) {
        await page.nativeClick(target.x, target.y);
        return { ...target, clickMode: 'native' };
    }

    const result = await page.evaluate(`
    (() => {
      const ignoredArea = '.comment, .comments, .comment-item, .comment-list';
      const isVisible = (el) => {
        if (!el) return null;
        const rect = el.getBoundingClientRect?.();
        if (!rect || rect.width < 8 || rect.height < 8) return null;
        const style = window.getComputedStyle?.(el);
        if (style && (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)) {
          return null;
        }
        return rect;
      };
      const readElement = (el, selector, rank) => {
        if (!el || el.closest(ignoredArea)) return null;
        const profileLink = el.matches?.('a[href*="/user/profile/"]')
          ? el
          : el.closest?.('a[href*="/user/profile/"]');
        const clickTarget = profileLink || el.closest?.('.avatar-click, .avatar-container, .username, button, [role="button"], a') || el;
        if (profileLink) {
          profileLink.setAttribute('target', '_self');
        }
        if (!isVisible(clickTarget) && !isVisible(el)) return null;
        return { clickTarget, selector, rank, href: profileLink?.href || clickTarget.closest?.('a[href*="/user/profile/"]')?.href || '' };
      };
      const candidates = [];
      const pushAll = (selector, rank) => {
        document.querySelectorAll(selector).forEach((el) => {
          const candidate = readElement(el, selector, rank);
          if (candidate) candidates.push(candidate);
        });
      };

      pushAll('#noteContainer a[href*="/user/profile/"]', 0);
      pushAll('a[href*="/user/profile/"]', 1);
      pushAll('#noteContainer .avatar-click, #noteContainer .avatar-container, #noteContainer .username', 2);
      pushAll('.avatar-click, .avatar-container, .username', 3);

      const target = candidates.sort((a, b) => {
        if (a.rank !== b.rank) return a.rank - b.rank;
        if (!!b.href !== !!a.href) return Number(!!b.href) - Number(!!a.href);
        const ar = a.clickTarget.getBoundingClientRect();
        const br = b.clickTarget.getBoundingClientRect();
        return ar.top - br.top || ar.left - br.left;
      })[0];

      if (!target) return { ok: false };
      target.clickTarget.scrollIntoView({ block: 'center', inline: 'center' });
      target.clickTarget.click();
      return { ok: true, selector: target.selector, href: target.href };
    })()
  `);
    if (!result?.ok) {
        throw new Error('Could not click the author avatar from the board note detail page.');
    }

    return { ...target, clickMode: 'dom' };
}

async function waitForProfilePage(page) {
    let lastHref = '';
    for (let attempt = 0; attempt < 24; attempt += 1) {
        const state = await page.evaluate(`
      (() => {
        const href = location.href;
        const match = href.match(/\\/user\\/profile\\/([a-zA-Z0-9]+)/);
        return { href, profileId: match?.[1] || '' };
      })()
    `);
        lastHref = state?.href || lastHref;
        if (state?.profileId) {
            return state;
        }
        await page.wait({ time: 0.5 });
    }

    throw new Error(`Author avatar did not open a Xiaohongshu profile page. Current page: ${lastHref}`);
}

async function collectCurrentProfileNotes(page, userId, limit) {
    let snapshot = await readUserSnapshot(page);
    let results = extractXhsUserNotes(snapshot ?? {}, userId);
    let previousCount = results.length;

    for (let i = 0; results.length < limit && i < 4; i += 1) {
        await page.autoScroll({ times: 1, delayMs: 1500 });
        await page.wait({ time: 1 });
        snapshot = await readUserSnapshot(page);
        const nextResults = extractXhsUserNotes(snapshot ?? {}, userId);
        if (nextResults.length <= previousCount)
            break;
        results = nextResults;
        previousCount = nextResults.length;
    }

    return results;
}

cli({
    site: 'xiaohongshu',
    name: 'board-profile',
    description: 'Open a Xiaohongshu board card, click the author avatar, and collect notes from that profile',
    domain: 'www.xiaohongshu.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'target', type: 'string', required: true, positional: true, help: 'Board URL with optional #card=N index' },
        { name: 'limit', type: 'int', default: 15, help: 'Number of profile notes to return' },
        { name: 'home-url', type: 'string', default: DEFAULT_HOME_URL, help: 'Xiaohongshu home page to open before visiting the board' },
        { name: 'home-wait-seconds', type: 'number', default: DEFAULT_HOME_WAIT_SECONDS, help: 'Seconds to stay on the home page before visiting the board' },
        { name: 'board-wait-seconds', type: 'number', default: DEFAULT_BOARD_WAIT_SECONDS, help: 'Seconds to stay on the board before clicking the card image' },
        { name: 'profile-wait-seconds', type: 'number', default: DEFAULT_PROFILE_WAIT_SECONDS, help: 'Seconds to wait after entering the author profile' },
    ],
    columns: ['id', 'title', 'type', 'likes', 'author', 'url'],
    func: async (page, kwargs) => {
        const { boardUrl, cardIndex } = parseBoardTarget(kwargs.target);
        const limit = Math.max(1, Number(kwargs.limit ?? 15));
        const homeUrl = normalizeXhsUrl(kwargs['home-url'], DEFAULT_HOME_URL);
        const homeWaitSeconds = toNonNegativeNumber(kwargs['home-wait-seconds'], DEFAULT_HOME_WAIT_SECONDS);
        const boardWaitSeconds = toNonNegativeNumber(kwargs['board-wait-seconds'], DEFAULT_BOARD_WAIT_SECONDS);
        const profileWaitSeconds = toNonNegativeNumber(kwargs['profile-wait-seconds'], DEFAULT_PROFILE_WAIT_SECONDS);

        await page.goto(homeUrl);
        if (homeWaitSeconds > 0) {
            await page.wait({ time: homeWaitSeconds });
        }

        await page.goto(boardUrl);
        if (boardWaitSeconds > 0) {
            await page.wait({ time: boardWaitSeconds });
        }

        await clickBoardCard(page, cardIndex);
        await page.wait({ time: 2 + Math.random() * 2 });
        const boardNoteUrl = await page.evaluate('location.href').catch(() => '');

        await clickAuthorAvatar(page);
        const profileState = await waitForProfilePage(page);
        const userId = normalizeXhsUserId(profileState.profileId || profileState.href);
        if (profileWaitSeconds > 0) {
            await page.wait({ time: profileWaitSeconds });
        }

        const results = await collectCurrentProfileNotes(page, userId, limit);
        if (results.length === 0) {
            throw new Error('No public notes found after clicking the board note author avatar.');
        }

        const dwellSeconds = Math.max(0, Number(process.env.OPENCLI_XHS_USER_DWELL_SECONDS ?? 8));
        const dwellJitterSeconds = Math.max(0, Number(process.env.OPENCLI_XHS_USER_DWELL_JITTER_SECONDS ?? 4));
        if (Number.isFinite(dwellSeconds) && dwellSeconds > 0) {
            const jitter = Number.isFinite(dwellJitterSeconds) && dwellJitterSeconds > 0
                ? Math.random() * dwellJitterSeconds
                : 0;
            await page.wait({ time: dwellSeconds + jitter });
        }

        return results.slice(0, limit).map((item) => ({
            ...item,
            author: userId,
            profile_id: userId,
            profile_url: profileState.href,
            board_url: boardUrl,
            board_card_index: cardIndex,
            board_note_url: boardNoteUrl,
        }));
    },
});
