import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const DRIBBBLE_ORIGIN = 'https://dribbble.com';
export const DRIBBBLE_HOST = 'dribbble.com';

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
    if (designer.length > 100 || designer.includes('/') || designer.includes('?') || designer.includes('#')) {
        throw new ArgumentError('designer must be a Dribbble username or profile slug');
    }
    return designer;
}

export function requireRows(payload, command) {
    if (!payload || typeof payload !== 'object') {
        throw new CommandExecutionError(`${command} returned an unreadable browser payload`);
    }
    if (!payload.ok) {
        const reason = payload.reason ? `: ${payload.reason}` : '';
        throw new CommandExecutionError(`${command} selector drift${reason}`);
    }
    if (!Array.isArray(payload.rows) || payload.rows.length === 0) {
        throw new EmptyResultError(command, `${command} page loaded but no matching rows were found`);
    }
    return payload.rows;
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
    const root = document.querySelector('#content');
    const cards = [...document.querySelectorAll('li[id^="screenshot-"]')];
    if (!root) {
        return { ok: false, reason: 'shot result root #content was not found', title: document.title || '' };
    }

    const rows = cards.map((el, index) => {
        const shotLink = [...el.querySelectorAll('a[href]')]
            .find((anchor) => /^\/shots\/[^/]+/.test(anchor.getAttribute('href') || ''));
        if (!shotLink) return null;
        const profileLink = [...el.querySelectorAll('a[href]')]
            .find((anchor) => /^\/[^/]+$/.test(anchor.getAttribute('href') || ''));
        const image = el.querySelector('img');
        return {
            rank: index + 1,
            id: clean(el.getAttribute('data-thumbnail-id') || el.id.replace(/^screenshot-/, '')),
            title: clean(el.querySelector('.shot-title')?.textContent || image?.getAttribute('alt') || ''),
            designer: clean(profileLink?.textContent || ''),
            likes: count(el.querySelector('.js-shot-likes-container')?.textContent),
            views: count(el.querySelector('.js-shot-views-count')?.textContent),
            imageUrl: clean(image?.currentSrc || image?.getAttribute('src') || image?.getAttribute('data-src') || ''),
            url: new URL(shotLink.getAttribute('href'), location.href).href,
        };
    }).filter((row) => row && row.id && row.title && row.url);

    return { ok: true, rows: rows.slice(0, limit) };
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

    const rows = cards.map((el, index) => {
        const profilePath = el.getAttribute('data-profile-path') || '';
        const subheading = [...el.querySelectorAll('.user-card-profile__subheading-item')]
            .map((item) => clean(item.textContent))
            .filter(Boolean);
        const budget = subheading.find((item) => /\$|project/i.test(item)) || '';
        const responseTime = subheading.find((item) => /responds/i.test(item)) || '';
        const locationText = subheading.find((item) => item !== budget && item !== responseTime && item !== '');
        const ratingText = clean(el.querySelector('.designer-ratings-score__link')?.textContent || '');
        const projectText = clean(el.querySelector('.designer-ratings__project-count')?.textContent || '');
        const serviceLink = [...el.querySelectorAll('a[href]')]
            .find((anchor) => /\/services$/.test(anchor.getAttribute('href') || ''));
        const serviceText = clean(serviceLink?.textContent || '');
        const skills = [...el.querySelectorAll('.user-skills__item')]
            .map((item) => clean(item.textContent))
            .filter(Boolean);
        return {
            rank: index + 1,
            id: clean(el.getAttribute('data-id') || ''),
            username: clean(el.getAttribute('data-username') || ''),
            name: clean(el.getAttribute('data-display-name') || el.querySelector('.user-card-profile__heading-name')?.textContent || ''),
            rating: numberFrom(ratingText),
            projectCount: numberFrom(projectText),
            budgetText: budget || null,
            location: locationText || null,
            responseTime: responseTime || null,
            serviceCount: numberFrom(serviceText),
            skills,
            url: profilePath ? new URL(profilePath, document.location.href).href : '',
            avatarUrl: clean(el.querySelector('img')?.src || ''),
        };
    }).filter((row) => row.username && row.name && row.url);

    return { ok: true, rows: rows.slice(0, limit) };
}

export function extractProfileRow(username) {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const numberFrom = (value) => {
        const match = clean(value).replace(/,/g, '').match(/\d+(?:\.\d+)?/);
        return match ? Number(match[0]) : null;
    };
    const profile = document.querySelector('.profile-masthead, .masthead-profile-name')?.closest('main, body') || document.body;
    const name = clean(document.querySelector('.masthead-profile-name, .profile-masthead h1, h1')?.textContent || '');
    if (!name || !profile) {
        return { ok: false, reason: 'profile identity was not found', title: document.title || '' };
    }

    const stats = [...document.querySelectorAll('.masthead-stats .stat, .profile-masthead .stat')];
    const statValue = (pattern) => numberFrom(stats.find((stat) => pattern.test(clean(stat.textContent)))?.textContent);
    const website = [...document.querySelectorAll('.user-contact-info a[href], .profile-masthead a[href]')]
        .map((anchor) => anchor.getAttribute('href') || '')
        .find((href) => /^https?:\/\//i.test(href) && !/dribbble\.com/i.test(href)) || '';
    const avatar = document.querySelector('.masthead-avatar img, .profile-masthead img')?.currentSrc
        || document.querySelector('.masthead-avatar img, .profile-masthead img')?.src
        || '';
    const availableText = clean(document.querySelector('.user-sticky-header__available, .profile-masthead [class*="available"]')?.textContent || '');
    const intro = clean(document.querySelector('.masthead-intro, .profile-masthead .bio')?.textContent || '');

    return {
        ok: true,
        row: {
            username,
            name,
            intro: intro || null,
            followersCount: statValue(/followers/i),
            followingCount: statValue(/following/i),
            likesCount: statValue(/likes/i),
            availableForWork: /available for work/i.test(availableText),
            website: website || null,
            url: document.location.href,
            avatarUrl: clean(avatar) || null,
        },
    };
}

export function extractServiceRows(designer, limit) {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const root = document.querySelector('#content');
    const cards = [...document.querySelectorAll('.service-card[role="article"]')];
    if (!root) {
        return { ok: false, reason: 'service result root #content was not found', title: document.title || '' };
    }

    const rows = cards.map((el, index) => {
        const button = el.querySelector('button[data-remote-url], button[data-remote-route-url]');
        const detailPath = button?.getAttribute('data-remote-route-url') || button?.getAttribute('data-remote-url') || '';
        const meta = [...el.querySelectorAll('.service-card__content .display-flex.gap-8 span')]
            .map((item) => clean(item.textContent))
            .filter(Boolean);
        const description = clean(el.querySelector('.service-card__description, .text-clip-2')?.textContent || '');
        const cardText = clean(el.textContent);
        return {
            rank: index + 1,
            id: clean(button?.getAttribute('data-search-service-clicked') || detailPath.match(/\/services\/(\d+)/)?.[1] || ''),
            title: clean(el.querySelector('.service-card__title, h3')?.textContent || button?.getAttribute('aria-label')?.replace(/^View service:\s*/i, '') || ''),
            priceText: meta[0] || null,
            duration: meta[1] || null,
            description: description ? description.slice(0, 800) : null,
            quickHire: /quick hire/i.test(cardText),
            url: detailPath ? new URL(detailPath, location.href).href : '',
            imageUrl: clean(el.querySelector('img')?.currentSrc || el.querySelector('img')?.src || el.querySelector('img')?.getAttribute('data-src') || ''),
            designer,
        };
    }).filter((row) => row.id && row.title && row.url);

    return { ok: true, rows: rows.slice(0, limit) };
}
