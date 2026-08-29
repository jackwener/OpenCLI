import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const DRIBBBLE_ORIGIN = 'https://dribbble.com';
export const DRIBBBLE_HOST = 'dribbble.com';

const TYPED_ERROR_CODES = new Set(['ARGUMENT', 'AUTH_REQUIRED', 'COMMAND_EXEC', 'EMPTY_RESULT', 'TIMEOUT']);

export async function hasDribbbleSessionCookie(page) {
    const cookies = await page.getCookies({ url: DRIBBBLE_ORIGIN });
    const names = new Set((cookies || []).map((cookie) => cookie.name));
    return names.has('_dribbble_session') || names.has('window._drbbbv_sess') || names.has('has_logged_in');
}

export function normalizeLimit(value, defaultValue = 20, maxValue = 30, label = 'limit') {
    const raw = value ?? defaultValue;
    const limit = Number(raw);
    if (!Number.isInteger(limit) || limit <= 0) {
        throw new ArgumentError(`${label} must be a positive integer`);
    }
    if (limit > maxValue) {
        throw new ArgumentError(`${label} must be <= ${maxValue}`);
    }
    return limit;
}

export function requireQuery(value, label = 'query') {
    const query = String(value ?? '').trim();
    if (!query) throw new ArgumentError(`${label} is required`);
    if (query.length > 100) throw new ArgumentError(`${label} must be <= 100 characters`);
    return query;
}

export function optionalQuery(value, label = 'query') {
    const query = String(value ?? '').trim();
    if (query.length > 100) throw new ArgumentError(`${label} must be <= 100 characters`);
    return query;
}

export function requireDesigner(value) {
    const designer = String(value ?? '').trim();
    if (!designer) throw new ArgumentError('designer is required (for example: halolab)');
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(designer)) {
        throw new ArgumentError('designer must be a Dribbble username or profile slug');
    }
    return designer;
}

export function requireShotTarget(value) {
    const target = String(value ?? '').trim();
    if (!target) throw new ArgumentError('shot is required (numeric id or dribbble.com/shots URL)');
    if (/^\d+$/.test(target)) return target;

    let url;
    try {
        url = new URL(target);
    } catch {
        throw new ArgumentError('shot must be a numeric id or dribbble.com/shots URL');
    }
    if (!/(^|\.)dribbble\.com$/i.test(url.hostname)) {
        throw new ArgumentError('shot URL must use dribbble.com');
    }
    const match = url.pathname.match(/^\/shots\/(\d+)(?:-|\/|$)/);
    if (!match) throw new ArgumentError('shot URL must match dribbble.com/shots/<id>');
    return match[1];
}

export function requireRows(payload, command) {
    if (!payload || typeof payload !== 'object') {
        throw new CommandExecutionError(`${command} returned an unreadable browser payload`);
    }
    if (payload.empty) {
        throw new EmptyResultError(command, payload.reason || `${command} returned no results`);
    }
    if (!payload.ok) {
        const reason = payload.reason ? `: ${payload.reason}` : '';
        throw new CommandExecutionError(`${command} selector drift${reason}`);
    }
    if (!Array.isArray(payload.rows)) {
        throw new CommandExecutionError(`${command} returned a malformed rows payload`);
    }
    if (payload.rows.length === 0) {
        throw new EmptyResultError(command, `${command} page loaded but no matching rows were found`);
    }
    return payload.rows;
}

export function requireRow(payload, command) {
    if (!payload || typeof payload !== 'object') {
        throw new CommandExecutionError(`${command} returned an unreadable browser payload`);
    }
    if (payload.empty) {
        throw new EmptyResultError(command, payload.reason || `${command} was not found`);
    }
    if (!payload.ok || !payload.row) {
        const reason = payload.reason ? `: ${payload.reason}` : '';
        throw new CommandExecutionError(`${command} selector drift${reason}`);
    }
    return payload.row;
}

export async function runBrowserTask(label, task) {
    try {
        return await task();
    } catch (error) {
        if (TYPED_ERROR_CODES.has(error?.code)) throw error;
        throw new CommandExecutionError(`${label} failed: ${error?.message ?? error}`);
    }
}

export function extractShotRows(limit) {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const count = (value) => {
        const text = clean(value).replace(/,/g, '');
        const match = text.match(/^(\d+(?:\.\d+)?)\s*([kmb])?$/i);
        if (!match) return null;
        const multiplier = { k: 1e3, m: 1e6, b: 1e9 }[String(match[2] ?? '').toLowerCase()] ?? 1;
        return Number(match[1]) * multiplier;
    };
    const root = document.querySelector('#content, main, [role="main"]');
    const cards = [...document.querySelectorAll('li[id^="screenshot-"]')];
    if (/whoops, that page is gone/i.test(document.body?.textContent || '')) {
        return { ok: true, empty: true, reason: 'Dribbble profile or shot page was not found' };
    }
    if (!root) {
        return { ok: false, reason: 'shot result root was not found', title: document.title || '' };
    }
    const searchEmpty = /^\/search\/shots\/(?:following|popular|recent)\/?$/.test(document.location.pathname)
        && document.body?.id === 'search-results'
        && document.querySelector('#wrap > .no-results');
    const portfolioEmpty = /^\/[A-Za-z0-9_-]+\/(?:shots|likes)\/?$/.test(document.location.pathname)
        && root.querySelector('.empty-shots-list');
    if (cards.length === 0 && !searchEmpty && !portfolioEmpty) {
        return { ok: false, reason: 'shot cards and the empty-state marker were not found', title: document.title || '' };
    }

    const parsedCards = cards.map((el) => {
        const anchors = [...el.querySelectorAll('a[href]')];
        const shotLink = anchors.find((anchor) => {
            try {
                const target = new URL(anchor.getAttribute('href') || '', location.href);
                return /(^|\.)dribbble\.com$/i.test(target.hostname)
                    && /^\/shots\/\d+(?:-[^/]+)?\/?$/.test(target.pathname);
            } catch {
                return false;
            }
        });
        if (!shotLink) {
            const hasOutboundTarget = anchors.some((anchor) => {
                try {
                    return !/(^|\.)dribbble\.com$/i.test(
                        new URL(anchor.getAttribute('href') || '', location.href).hostname,
                    );
                } catch {
                    return false;
                }
            });
            const isPromoted = hasOutboundTarget
                && anchors.some((anchor) => /^\/advertise\/?$/.test(anchor.getAttribute('href') || ''));
            return { promoted: isPromoted };
        }
        const profileLink = el.querySelector('.user-information a[href], a[data-search-profile-clicked][href]');
        const image = el.querySelector('img');
        const row = {
            rank: 0,
            id: clean(el.getAttribute('data-thumbnail-id') || el.id.replace(/^screenshot-/, '')),
            title: clean(el.querySelector('.shot-title')?.textContent || image?.getAttribute('alt') || ''),
            designer: clean(profileLink?.textContent || ''),
            likes: count(el.querySelector('[data-shot-like-count], .js-shot-likes-container')?.textContent),
            views: count(el.querySelector('.js-shot-views-count')?.textContent),
            imageUrl: clean(image?.currentSrc || image?.getAttribute('src') || image?.getAttribute('data-src') || ''),
            url: new URL(shotLink.getAttribute('href'), location.href).href,
        };
        return { row };
    });
    if (parsedCards.some((card) => !card.promoted && (!card.row || !card.row.id || !card.row.title || !card.row.url))) {
        return { ok: false, reason: 'one or more shot cards were missing required identity fields' };
    }
    const parsedRows = parsedCards
        .flatMap((card) => card.row ? [card.row] : [])
        .map((row, index) => ({ ...row, rank: index + 1 }));
    if (parsedRows.length === 0 && cards.length > 0) {
        return { ok: false, reason: 'shot results contained only promoted cards' };
    }

    return { ok: true, rows: parsedRows.slice(0, limit) };
}

export function extractDesignerRows(limit) {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const numberFrom = (value) => {
        const match = clean(value).replace(/,/g, '').match(/\d+(?:\.\d+)?/);
        return match ? Number(match[0]) : null;
    };
    const root = document.querySelector('.designer-search-results');
    const cards = [...document.querySelectorAll('[data-resume-user-card]')];
    if (!root) {
        return { ok: false, reason: 'designer result root was not found', title: document.title || '' };
    }
    if (cards.length === 0 && !root.querySelector('[data-designer-search-infinite-scroll][disabled]')) {
        return { ok: false, reason: 'designer cards and the completed empty-state marker were not found', title: document.title || '' };
    }

    const parsedRows = cards.map((el, index) => {
        const profilePath = el.getAttribute('data-profile-path') || '';
        const subheading = [...el.querySelectorAll('.user-card-profile__subheading-item')]
            .map((item) => clean(item.textContent))
            .filter(Boolean);
        const budget = subheading.find((item) => /\$|project/i.test(item)) || '';
        const responseTime = subheading.find((item) => /responds/i.test(item)) || '';
        const locationText = subheading.find((item) => item !== budget && item !== responseTime && item !== '');
        const serviceLink = [...el.querySelectorAll('a[href]')]
            .find((anchor) => /\/services$/.test(anchor.getAttribute('href') || ''));
        const skills = [...el.querySelectorAll('.user-skills__item')]
            .map((item) => clean(item.textContent))
            .filter(Boolean);
        return {
            rank: index + 1,
            id: clean(el.getAttribute('data-id') || ''),
            username: clean(el.getAttribute('data-username') || ''),
            name: clean(el.getAttribute('data-display-name') || el.querySelector('.user-card-profile__heading-name')?.textContent || ''),
            rating: numberFrom(el.querySelector('.designer-ratings-score__link')?.textContent),
            projectCount: numberFrom(el.querySelector('.designer-ratings__project-count')?.textContent),
            budgetText: budget || null,
            location: locationText || null,
            responseTime: responseTime || null,
            serviceCount: numberFrom(serviceLink?.textContent),
            skills,
            url: profilePath ? new URL(profilePath, document.location.href).href : '',
            avatarUrl: clean(el.querySelector('img')?.src || ''),
        };
    });
    if (parsedRows.some((row) => !row.username || !row.name || !row.url)) {
        return { ok: false, reason: 'one or more designer cards were missing required identity fields' };
    }

    return { ok: true, rows: parsedRows.slice(0, limit) };
}

export function extractProfileRow(username) {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const numberFrom = (value) => {
        const match = clean(value).replace(/,/g, '').match(/\d+(?:\.\d+)?/);
        return match ? Number(match[0]) : null;
    };
    if (/whoops, that page is gone/i.test(document.body?.textContent || '')) {
        return { ok: true, empty: true, reason: `Dribbble profile "${username}" was not found` };
    }

    const masthead = document.querySelector('[data-profile-masthead-container], .profile-masthead');
    const name = clean(masthead?.querySelector('.masthead-profile-name h1, h1')?.textContent || '');
    if (!masthead || !name) {
        return { ok: false, reason: 'profile masthead identity was not found', title: document.title || '' };
    }

    const mastheadText = clean(masthead.textContent);
    const statValue = (label) => numberFrom(mastheadText.match(new RegExp(`([\\d,.]+(?:[kmb])?)\\s+${label}`, 'i'))?.[1]);
    const main = document.querySelector('main, [role="main"]');
    const mainText = clean(main?.textContent || '');
    const headingContainer = (label) => [...(main?.querySelectorAll('h2, h3') || [])]
        .find((heading) => clean(heading.textContent).toLowerCase() === label.toLowerCase())?.parentElement;
    const biography = [...(headingContainer('Biography')?.querySelectorAll('p') || [])]
        .map((item) => clean(item.textContent))
        .filter(Boolean)
        .join('\n\n');
    const skills = [...(main?.querySelectorAll('a[href^="/skills/"]') || [])]
        .map((anchor) => clean(anchor.textContent))
        .filter(Boolean);
    const languages = [...(headingContainer('Languages')?.querySelectorAll('li') || [])]
        .map((item) => clean(item.textContent))
        .filter(Boolean);
    const socialLinks = [...(headingContainer('Social')?.querySelectorAll('a[href]') || [])]
        .map((anchor) => anchor.href)
        .filter(Boolean);
    const locationText = [...(main?.querySelectorAll('p') || [])]
        .map((item) => clean(item.textContent))
        .find((text) => /,\s*[A-Z]{2}$|,\s*[A-Za-z ]+$/.test(text) && text.length < 100) || '';
    const memberSince = [...(main?.querySelectorAll('p') || [])]
        .map((item) => clean(item.textContent))
        .find((text) => /^Member since\s+/i.test(text))
        ?.replace(/^Member since\s+/i, '') || '';
    const socialHosts = /(^|\.)(?:twitter|x|facebook|instagram|github|behance|linkedin)\.com$/i;
    const socialWebsite = socialLinks.find((href) => {
        const host = new URL(href).hostname;
        return !/(^|\.)dribbble\.com$/i.test(host) && !socialHosts.test(host) && host !== 'cal.com';
    });
    const website = socialWebsite || [...(main?.querySelectorAll('a[href^="http"]') || [])]
        .map((anchor) => anchor.href)
        .find((href) => {
            const host = new URL(href).hostname;
            return !/(^|\.)dribbble\.com$/i.test(host) && !socialHosts.test(host) && host !== 'cal.com';
        }) || '';
    const avatar = masthead.querySelector('img[src]')?.currentSrc || masthead.querySelector('img[src]')?.src || '';

    return {
        ok: true,
        row: {
            username,
            name,
            intro: clean(masthead.querySelector('.masthead-intro, .profile-masthead h2')?.textContent) || null,
            biography: biography || null,
            followersCount: statValue('followers'),
            followingCount: statValue('following'),
            likesCount: statValue('likes'),
            availableForWork: /available for (?:new )?(?:work|projects)/i.test(`${mastheadText} ${mainText}`),
            location: locationText || null,
            memberSince: memberSince || null,
            skills,
            languages,
            socialLinks,
            website: website || null,
            url: document.location.href.replace(/\/about\/?$/, ''),
            avatarUrl: clean(avatar) || null,
        },
    };
}

export function extractServiceRows(designer) {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const root = document.querySelector('#content, main, [role="main"]');
    const cards = [...document.querySelectorAll('.service-card[role="article"]')];
    if (!root) {
        return { ok: false, reason: 'service result root was not found', title: document.title || '' };
    }
    if (/whoops, that page is gone/i.test(document.body?.textContent || '')) {
        return { ok: true, empty: true, reason: `Dribbble profile "${designer}" was not found` };
    }
    if (cards.length === 0 && !document.querySelector('li.services.active.empty')) {
        return { ok: false, reason: 'service cards and the empty profile-tab marker were not found', title: document.title || '' };
    }

    const parsedRows = cards.map((el, index) => {
        const button = el.querySelector('button[data-remote-url], button[data-remote-route-url]');
        const detailPath = button?.getAttribute('data-remote-route-url') || button?.getAttribute('data-remote-url') || '';
        const meta = [...el.querySelectorAll('.service-card__content .display-flex.gap-8 span')]
            .map((item) => clean(item.textContent))
            .filter(Boolean);
        const duration = meta.find((item) => /\b(?:day|days|week|weeks|month|months)\b/i.test(item)) || null;
        const description = clean(el.querySelector('.service-card__description, .text-clip-2')?.textContent || '');
        const cardText = clean(el.textContent);
        return {
            rank: index + 1,
            id: clean(button?.getAttribute('data-search-service-clicked') || detailPath.match(/\/services\/(\d+)/)?.[1] || ''),
            title: clean(el.querySelector('.service-card__title, h3')?.textContent || button?.getAttribute('aria-label')?.replace(/^View service:\s*/i, '') || ''),
            priceText: meta.find((item) => /\$/.test(item)) || null,
            duration,
            description: description ? description.slice(0, 800) : null,
            quickHire: /quick hire/i.test(cardText),
            url: detailPath ? new URL(detailPath, location.href).href : '',
            imageUrl: clean(el.querySelector('img')?.currentSrc || el.querySelector('img')?.src || el.querySelector('img')?.getAttribute('data-src') || ''),
            designer,
        };
    });
    if (parsedRows.some((row) => !row.id || !row.title || !row.url)) {
        return { ok: false, reason: 'one or more service cards were missing required identity fields' };
    }

    return { ok: true, rows: parsedRows };
}

export function extractShotDetailRow(shotId) {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    if (/whoops, that page is gone/i.test(document.body?.textContent || '')) {
        return { ok: true, empty: true, reason: `Dribbble shot "${shotId}" was not found` };
    }
    const root = document.querySelector('#content')
        || document.querySelector('.shot-container')
        || document.querySelector('main, [role="main"]');
    const title = clean(root?.querySelector('.shot-header__title, .shot-header h1, h1')?.textContent || '');
    const pageShotId = root?.querySelector('[data-shot-id], [data-screenshot_id]')?.getAttribute('data-shot-id')
        || root?.querySelector('[data-screenshot_id]')?.getAttribute('data-screenshot_id')
        || document.location.pathname.match(/^\/shots\/(\d+)/)?.[1]
        || '';
    if (!root || !title || pageShotId !== String(shotId)) {
        return { ok: false, reason: 'shot identity was not found', title: document.title || '' };
    }

    const profileLinks = [...root.querySelectorAll('.user-sticky-header__name a[href]')]
        .map((anchor) => ({ name: clean(anchor.textContent), href: anchor.getAttribute('href') || '' }))
        .filter((item) => item.name && /^\/[A-Za-z0-9_-]+$/.test(item.href));
    const distinctProfiles = profileLinks.filter((item, index, items) => items.findIndex((entry) => entry.href === item.href) === index);
    const mediaUrls = [
        ...[...root.querySelectorAll('.shot-media-container img, .shot-media-container video, .shot-media-container source')]
            .map((media) => media.currentSrc || media.src || media.getAttribute('src') || ''),
        ...[...root.querySelectorAll('.shot-content a[href^="https://cdn.dribbble.com/"]')]
            .map((anchor) => anchor.href),
    ]
        .filter(Boolean)
        .filter((url, index, urls) => urls.indexOf(url) === index);
    const imageUrl = document.querySelector('meta[property="og:image"]')?.content || mediaUrls[0] || '';
    const colors = [...root.querySelectorAll('a[href*="?color="]')]
        .map((anchor) => clean(anchor.textContent).replace(/^#/, '').toUpperCase())
        .filter((value) => /^[0-9A-F]{6}$/.test(value))
        .filter((value, index, values) => values.indexOf(value) === index);

    return {
        ok: true,
        row: {
            id: String(shotId),
            title,
            designer: distinctProfiles[0]?.name || null,
            designerUrl: distinctProfiles[0] ? new URL(distinctProfiles[0].href, location.href).href : null,
            team: distinctProfiles[1]?.name || null,
            description: clean(root.querySelector('.shot-description-container')?.textContent) || null,
            imageUrl: imageUrl || null,
            mediaUrls,
            colors,
            availableForWork: /available for work/i.test(
                root.querySelector('.user-sticky-header__available')?.textContent || '',
            ),
            url: document.location.href,
        },
    };
}

export function extractCollectionRows(designer, limit) {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const root = document.querySelector('main, [role="main"]');
    if (!root) return { ok: false, reason: 'collection result root was not found' };
    if (/whoops, that page is gone/i.test(document.body?.textContent || '')) {
        return { ok: true, empty: true, reason: `Dribbble profile "${designer}" was not found` };
    }

    const prefix = `/${designer}/collections/`.toLowerCase();
    const parsedRows = [...root.querySelectorAll('a[href]')]
        .map((anchor) => ({ anchor, href: anchor.getAttribute('href') || '' }))
        .filter(({ href }) => href.toLowerCase().startsWith(prefix))
        .map(({ anchor, href }, index) => {
            const id = href.match(/\/collections\/(\d+)/)?.[1] || '';
            const text = clean(anchor.textContent);
            const shotCount = Number(text.replace(/,/g, '').match(/(\d+)\s+Shots?/i)?.[1] || NaN);
            const designerCount = Number(text.replace(/,/g, '').match(/(\d+)\s+Designers?/i)?.[1] || NaN);
            const title = clean(anchor.querySelector('h2, h3, [class*="title"]')?.textContent)
                || text.replace(/\s+\d[\d,]*\s+Shots?.*$/i, '').trim();
            return {
                rank: index + 1,
                id,
                title,
                shotCount: Number.isFinite(shotCount) ? shotCount : null,
                designerCount: Number.isFinite(designerCount) ? designerCount : null,
                url: new URL(href, location.href).href,
            };
        });
    if (parsedRows.some((row) => !row.id || !row.title)) {
        return { ok: false, reason: 'one or more collection cards were missing required identity fields' };
    }
    const rows = parsedRows
        .filter((row, index, rows) => rows.findIndex((entry) => entry.id === row.id) === index)
        .slice(0, limit);
    if (rows.length === 0 && !document.querySelector('li.collections.active.empty')) {
        return { ok: false, reason: 'collection cards and the empty profile-tab marker were not found' };
    }
    return { ok: true, rows };
}

export function extractMemberRows(designer, limit) {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const root = document.querySelector('main, [role="main"]');
    if (!root) return { ok: false, reason: 'member result root was not found' };
    if (/whoops, that page is gone/i.test(document.body?.textContent || '')) {
        return { ok: true, empty: true, reason: `Dribbble profile "${designer}" does not expose a team member directory` };
    }

    const cards = [...root.querySelectorAll('li[data-user-id]')]
        .filter((card) => card.querySelector('a[href$="/followers"]'));
    const parsedRows = cards.map((card, index) => {
        const profile = [...card.querySelectorAll('a[href]')].find((anchor) => {
            const href = anchor.getAttribute('href') || '';
            return /^\/[A-Za-z0-9_-]+$/.test(href) && href !== '/pro';
        });
        const href = profile?.getAttribute('href') || '';
        if (!profile || !href) return null;
        const shotUrls = [...card.querySelectorAll('a[href^="/shots/"]')]
            .map((anchor) => new URL(anchor.getAttribute('href'), location.href).href)
            .filter((url, shotIndex, urls) => urls.indexOf(url) === shotIndex);
        const locationText = clean(card.querySelector('[class*="location"]')?.textContent || '') || null;
        return {
            rank: index + 1,
            username: href.slice(1),
            name: clean(profile.textContent) || clean(profile.querySelector('img')?.alt || ''),
            location: locationText,
            url: new URL(href, location.href).href,
            avatarUrl: card.querySelector('img')?.currentSrc || card.querySelector('img')?.src || null,
            recentShotUrls: shotUrls,
        };
    });
    if (parsedRows.some((row) => !row || !row.username || !row.name)) {
        return { ok: false, reason: 'one or more team member cards were missing required identity fields' };
    }

    const uniqueRows = parsedRows
        .filter((row, index, items) => items.findIndex((item) => item.username === row.username) === index)
        .slice(0, limit)
        .map((row, index) => ({ ...row, rank: index + 1 }));
    if (uniqueRows.length === 0) {
        return { ok: false, reason: 'team member cards were not found' };
    }
    return {
        ok: true,
        rows: uniqueRows,
    };
}
