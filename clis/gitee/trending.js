import { CliError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { isRecord } from '@jackwener/opencli/utils';
const GITEE_EXPLORE_URL = 'https://gitee.com/explore';
const MAX_LIMIT = 50;
const MAX_DESCRIPTION_LENGTH = 48;
const GITEE_HOSTS = new Set(['gitee.com', 'www.gitee.com']);
const RESERVED_SEGMENTS = new Set([
    'about',
    'account',
    'ai',
    'all',
    'api',
    'apps',
    'blog',
    'contact',
    'dashboard',
    'docs',
    'enterprise',
    'enterprises',
    'explore',
    'features',
    'help',
    'issues',
    'login',
    'marketplace',
    'organizations',
    'pricing',
    'pulls',
    'security',
    'settings',
    'signup',
    'sitemap',
    'stars',
    'support',
    'terms',
    'users',
]);
const STAR_KEYS = [
    'stars',
    'star',
    'stars_count',
    'star_count',
    'stargazers_count',
    'stargazer_count',
    'watch_count',
    'watchers_count',
];
function normalizeWhitespace(value) {
    return value.replace(/\s+/g, ' ').trim();
}
function normalizeStars(value) {
    const compact = normalizeWhitespace(value).replace(/\s+/g, '');
    if (!compact)
        return '-';
    const match = compact.match(/\d+(?:[.,]\d+)?(?:[kKmMwW]|\u4E07)?/);
    return match ? match[0] : compact;
}
function compactDescription(value) {
    const normalized = normalizeWhitespace(value);
    if (!normalized || normalized === '-')
        return '-';
    if (normalized.length <= MAX_DESCRIPTION_LENGTH)
        return normalized;
    return `${normalized.slice(0, MAX_DESCRIPTION_LENGTH - 3)}...`;
}
function clampLimit(value) {
    const parsed = Number(value);
    if (Number.isNaN(parsed))
        return 20;
    return Math.max(1, Math.min(parsed, MAX_LIMIT));
}
function normalizeRepoUrl(value) {
    try {
        const parsed = new URL(value, 'https://gitee.com');
        if (!GITEE_HOSTS.has(parsed.hostname.toLowerCase()))
            return null;
        const parts = parsed.pathname.split('/').filter(Boolean);
        if (parts.length !== 2)
            return null;
        const owner = parts[0];
        const repo = parts[1];
        if (RESERVED_SEGMENTS.has(owner.toLowerCase()) || RESERVED_SEGMENTS.has(repo.toLowerCase()))
            return null;
        return `https://gitee.com/${owner}/${repo}`;
    }
    catch {
        return null;
    }
}
function repoUrlFromPath(value) {
    const compact = value.trim().replace(/^\/+|\/+$/g, '');
    if (!compact.includes('/'))
        return null;
    return normalizeRepoUrl(`https://gitee.com/${compact}`);
}
function toCaptureProject(record) {
    const urlCandidates = [];
    const pushUrlCandidate = (raw) => {
        if (typeof raw !== 'string')
            return;
        const normalized = normalizeRepoUrl(raw) ?? repoUrlFromPath(raw);
        if (normalized)
            urlCandidates.push(normalized);
    };
    pushUrlCandidate(record.url);
    pushUrlCandidate(record.html_url);
    pushUrlCandidate(record.project_url);
    pushUrlCandidate(record.web_url);
    pushUrlCandidate(record.path_with_namespace);
    pushUrlCandidate(record.name_with_namespace);
    pushUrlCandidate(record.full_name);
    pushUrlCandidate(record.fullName);
    pushUrlCandidate(record.path);
    const url = urlCandidates[0];
    if (!url)
        return null;
    let name = '';
    const nameCandidate = [
        record.name_with_namespace,
        record.full_name,
        record.fullName,
        record.path_with_namespace,
        record.name,
    ].find((value) => typeof value === 'string' && value.trim());
    if (typeof nameCandidate === 'string') {
        name = normalizeWhitespace(nameCandidate.replace(/\s*\/\s*/g, '/'));
    }
    let description = '';
    const descCandidate = [
        record.description,
        record.desc,
        record.summary,
        record.project_description,
        record.intro,
        record.tagline,
    ].find((value) => typeof value === 'string' && value.trim());
    if (typeof descCandidate === 'string') {
        description = normalizeWhitespace(descCandidate);
    }
    let stars = '';
    for (const key of STAR_KEYS) {
        const value = record[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
            stars = String(value);
            break;
        }
        if (typeof value === 'string' && value.trim()) {
            stars = value;
            break;
        }
    }
    return {
        url,
        name: name || undefined,
        description: description || undefined,
        stars: stars ? normalizeStars(stars) : undefined,
    };
}
function tryParseJson(raw) {
    const text = raw.trim();
    if (!text || (!text.startsWith('{') && !text.startsWith('[')))
        return null;
    try {
        return JSON.parse(text);
    }
    catch {
        const lastBrace = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
        if (lastBrace <= 0)
            return null;
        const clipped = text.slice(0, lastBrace + 1);
        try {
            return JSON.parse(clipped);
        }
        catch {
            return null;
        }
    }
}
function parseCaptureBody(entry) {
    if (!isRecord(entry))
        return null;
    const preview = typeof entry.responsePreview === 'string' ? entry.responsePreview : '';
    if (!preview || preview.startsWith('base64:'))
        return null;
    const contentType = typeof entry.responseContentType === 'string'
        ? entry.responseContentType.toLowerCase()
        : '';
    if (contentType && !contentType.includes('json') && !contentType.includes('javascript') && !contentType.includes('text')) {
        return null;
    }
    return tryParseJson(preview);
}
function choosePreferredText(current, incoming) {
    if (!incoming || incoming === '-')
        return current;
    if (!current || current === '-')
        return incoming;
    return incoming.length > current.length ? incoming : current;
}
function collectProjectsFromUnknown(value, out, seen, depth) {
    if (depth > 8 || value === null || value === undefined || typeof value !== 'object')
        return;
    if (seen.has(value))
        return;
    seen.add(value);
    if (Array.isArray(value)) {
        for (const item of value) {
            collectProjectsFromUnknown(item, out, seen, depth + 1);
        }
        return;
    }
    const record = value;
    const candidate = toCaptureProject(record);
    if (candidate) {
        const previous = out.get(candidate.url);
        if (!previous) {
            out.set(candidate.url, candidate);
        }
        else {
            out.set(candidate.url, {
                url: candidate.url,
                name: choosePreferredText(previous.name, candidate.name),
                description: choosePreferredText(previous.description, candidate.description),
                stars: previous.stars && previous.stars !== '-' ? previous.stars : candidate.stars,
            });
        }
    }
    for (const child of Object.values(record)) {
        collectProjectsFromUnknown(child, out, seen, depth + 1);
    }
}
function collectProjectsFromCapture(entries) {
    const collected = new Map();
    const seen = new Set();
    for (const entry of entries) {
        const body = parseCaptureBody(entry);
        if (body !== null) {
            collectProjectsFromUnknown(body, collected, seen, 0);
        }
    }
    return collected;
}
function toProject(value) {
    if (!value || typeof value !== 'object')
        return null;
    const row = value;
    const name = typeof row.name === 'string' ? normalizeWhitespace(row.name) : '';
    const urlRaw = typeof row.url === 'string' ? row.url.trim() : '';
    const url = normalizeRepoUrl(urlRaw);
    if (!name || !url)
        return null;
    const description = typeof row.description === 'string'
        ? normalizeWhitespace(row.description)
        : '';
    const stars = typeof row.stars === 'string' ? normalizeStars(row.stars) : '-';
    return {
        name,
        description: description || '-',
        stars,
        url,
    };
}
function mergeCapturedProject(project, captured) {
    if (!captured)
        return project;
    const mergedName = captured.name ? normalizeWhitespace(captured.name) : '';
    const mergedDescription = captured.description ? normalizeWhitespace(captured.description) : '';
    const mergedStars = captured.stars ? normalizeStars(captured.stars) : '-';
    return {
        name: mergedName && mergedName.length <= 120 ? mergedName : project.name,
        description: project.description !== '-' ? project.description : (mergedDescription || '-'),
        stars: project.stars !== '-' ? project.stars : mergedStars,
        url: project.url,
    };
}
cli({
    site: 'gitee',
    name: 'trending',
    access: 'read',
    description: 'Recommended open-source projects on Gitee Explore',
    domain: 'gitee.com',
    strategy: Strategy.PUBLIC,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of projects (max 50)' },
    ],
    columns: ['name', 'description', 'stars', 'url'],
    func: async (page, args) => {
        const limit = clampLimit(args.limit);
        let projectsFromCapture = new Map();
        if (page.startNetworkCapture) {
            try {
                await page.startNetworkCapture('gitee.com');
            }
            catch {
                // best-effort enrichment path
            }
        }
        await page.goto(GITEE_EXPLORE_URL);
        await page.wait(3);
        if (page.readNetworkCapture) {
            try {
                const captureEntries = await page.readNetworkCapture();
                projectsFromCapture = collectProjectsFromCapture(captureEntries);
            }
            catch {
                // best-effort enrichment path
            }
        }
        const rawProjects = await page.evaluate(`
      (() => {
        const RESERVED = new Set([
          'about',
          'account',
          'ai',
          'all',
          'api',
          'apps',
          'blog',
          'contact',
          'dashboard',
          'docs',
          'enterprise',
          'enterprises',
          'explore',
          'features',
          'help',
          'issues',
          'login',
          'marketplace',
          'organizations',
          'pricing',
          'pulls',
          'security',
          'settings',
          'signup',
          'sitemap',
          'stars',
          'support',
          'terms',
          'users',
        ]);

        const KEYWORDS = [
          '\\u63A8\\u8350\\u5F00\\u6E90\\u9879\\u76EE',
          '\\u63A8\\u8350\\u9879\\u76EE',
          '\\u63A8\\u8350\\u4ED3\\u5E93',
          'Recommended Projects',
        ];
        const STAR_TOKEN = /(\\d+(?:[.,]\\d+)?(?:\\s*[kKmMwW\\u4E07])?)/;

        const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();

        const toRepoUrl = (href) => {
          if (!href) return '';
          try {
            const url = new URL(href, location.origin);
            if (url.origin !== location.origin) return '';

            const parts = url.pathname.split('/').filter(Boolean);
            if (parts.length !== 2) return '';

            const owner = parts[0].toLowerCase();
            const repo = parts[1].toLowerCase();
            if (RESERVED.has(owner) || RESERVED.has(repo)) return '';

            return url.origin + '/' + parts[0] + '/' + parts[1];
          } catch {
            return '';
          }
        };

        const scoreCard = (node) => {
          const text = normalize(node.textContent || '');
          const linkCount = node.querySelectorAll('a[href]').length;
          if (!text || linkCount > 45) return -Infinity;

          const hasDesc = !!node.querySelector('.project-desc, .project-description, .description, .desc, [class*="desc"], [class*="intro"], [class*="summary"], p');
          const hasMetric = !!node.querySelector('a[href*="stargazers"], a[href*="stars"], [class*="star"], [class*="collect"], [class*="watch"], [aria-label*="star" i], [title*="star" i]');
          let score = Math.min(text.length, 1200) - linkCount * 6;
          if (hasDesc) score += 260;
          if (hasMetric) score += 360;
          if (/(?:stars?|star|stargazers?|\\u6536\\u85CF|\\u5173\\u6CE8|\\u70B9\\u8D5E|★|⭐)/i.test(text)) score += 220;
          return score;
        };

        const pickCard = (link) => {
          let best = link;
          let bestScore = scoreCard(link);
          let node = link;
          for (let i = 0; i < 7 && node.parentElement; i++) {
            node = node.parentElement;
            const score = scoreCard(node);
            if (score > bestScore) {
              best = node;
              bestScore = score;
            }
          }
          return best;
        };

        const extractStars = (card) => {
          const classToken = /(star|stargazer|collect|watch)/i;
          const metricNodes = card.querySelectorAll(
            'a[href*="stargazers"], a[href*="stars"], [class*="star"], [class*="collect"], [class*="watch"], [aria-label*="star" i], [title*="star" i], span, strong, small, em, div'
          );
          for (const node of metricNodes) {
            const className = String(node.className || '');
            const raw = normalize([
              node.textContent || '',
              node.getAttribute?.('title') || '',
              node.getAttribute?.('aria-label') || '',
              node.nextElementSibling?.textContent || '',
            ].join(' '));
            if (!raw) continue;
            if (!/(?:stars?|star|stargazers?|\\u6536\\u85CF|\\u5173\\u6CE8|\\u70B9\\u8D5E|★|⭐)/i.test(raw) && !classToken.test(className)) continue;
            const match = raw.match(STAR_TOKEN);
            if (match) return match[1].replace(/\\s+/g, '');
          }

          const directStar = card.querySelector(
            '.project-stars-count-box .stars-count, .stars-count, [class*="stars-count"], [class*="starsCount"]'
          );
          const directStarText = normalize(directStar?.textContent || '');
          const directMatch = directStarText.match(STAR_TOKEN);
          if (directMatch) return directMatch[1].replace(/\\s+/g, '');

          const text = normalize(card.textContent || '');
          const patterns = [
            /(?:stars?|star|stargazers?|\\u6536\\u85CF|\\u5173\\u6CE8|\\u70B9\\u8D5E)\\s*[:：]?\\s*(\\d+(?:[.,]\\d+)?(?:\\s*[kKmMwW\\u4E07])?)/i,
            /(\\d+(?:[.,]\\d+)?(?:\\s*[kKmMwW\\u4E07])?)\\s*(?:stars?|star|stargazers?|\\u6536\\u85CF|\\u5173\\u6CE8|\\u70B9\\u8D5E)/i,
            /[★⭐]\\s*(\\d+(?:[.,]\\d+)?(?:\\s*[kKmMwW\\u4E07])?)/,
          ];

          for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) return match[1].replace(/\\s+/g, '');
          }

          return '';
        };

        const pickDescription = (card, name) => {
          const directNodes = Array.from(
            card.querySelectorAll('.project-desc, .project-description, .description, .desc, [class*="description"], [class*="desc"], [class*="intro"], [class*="summary"], p')
          );

          const seen = new Set();
          const candidates = [];
          for (const node of directNodes) {
            const textCandidates = [
              node.textContent || '',
              node.getAttribute?.('title') || '',
              node.getAttribute?.('aria-label') || '',
            ].map((value) => normalize(value || '')).filter(Boolean);

            for (const text of textCandidates) {
              if (!text || text === name || seen.has(text)) continue;
              if (text.length < 6 || text.length > 320) continue;
              if (/^(?:stars?|star|fork|issues?|\\u6536\\u85CF|\\u5173\\u6CE8|\\u70B9\\u8D5E|\\d+(?:[.,]\\d+)?)$/i.test(text)) continue;
              seen.add(text);
              candidates.push(text);
            }
          }
          if (candidates.length > 0) {
            candidates.sort((left, right) => right.length - left.length);
            return candidates[0];
          }

          const text = normalize(card.textContent || '')
            .replace(/window\\.gon\\._errorText\\s*=\\s*\"[^\"]*\"/g, '');
          if (!text) return '-';
          const cleaned = text
            .replace(name, '')
            .replace(/(?:stars?|star|stargazers?|fork|issues?|\\u6536\\u85CF|\\u5173\\u6CE8|\\u70B9\\u8D5E)\\s*[:：]?\\s*\\d+(?:[.,]\\d+)?(?:\\s*[kKmMwW\\u4E07])?/ig, '')
            .replace(/\\d+(?:[.,]\\d+)?(?:\\s*[kKmMwW\\u4E07])?\\s*(?:stars?|star|stargazers?|\\u6536\\u85CF|\\u5173\\u6CE8|\\u70B9\\u8D5E)/ig, '')
            .replace(/\\|\\s*\\d+\\s*(?:\\u79D2\\u524D|\\u5206\\u949F\\u524D|\\u5C0F\\u65F6\\u524D|\\u5929\\u524D)/g, '')
            .replace(/\\s+/g, ' ')
            .trim();
          return cleaned ? cleaned.slice(0, 300) : '-';
        };

        const countRepoLinks = (root) => {
          const links = root.querySelectorAll('a[href]');
          let count = 0;
          for (const link of links) {
            if (toRepoUrl(link.getAttribute('href') || '')) count++;
          }
          return count;
        };

        let root = document;
        const headingNodes = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, div, span'))
          .filter((node) => {
            const text = normalize(node.textContent || '');
            if (!text || text.length > 20) return false;
            return KEYWORDS.some((keyword) => text.includes(keyword));
          });

        let bestCount = 0;
        for (const heading of headingNodes) {
          let candidate = heading;
          for (let i = 0; i < 4 && candidate.parentElement; i++) {
            candidate = candidate.parentElement;
            const count = countRepoLinks(candidate);
            if (count > bestCount) {
              bestCount = count;
              root = candidate;
            }
          }
        }

        const seen = new Set();
        const projects = [];
        const collect = (scope) => {
          const links = scope.querySelectorAll('a[href]');
          for (const link of links) {
            const url = toRepoUrl(link.getAttribute('href') || '');
            if (!url || seen.has(url)) continue;

            const card = pickCard(link);
            const titleAttr = normalize(link.getAttribute('title') || '');
            const nameText = normalize(link.textContent || '');
            const pathParts = new URL(url).pathname.split('/').filter(Boolean);
            const fallbackName = pathParts.join('/');
            const nameCandidate = titleAttr || nameText;
            const name = (nameCandidate && nameCandidate.length <= 120
              ? nameCandidate.replace(/\\s*\\/\\s*/g, '/')
              : fallbackName) || fallbackName;
            if (!name) continue;

            projects.push({
              name,
              description: pickDescription(card, name),
              stars: extractStars(card),
              url,
            });
            seen.add(url);
          }
        };

        collect(root);
        if (projects.length < 8 && root !== document) {
          collect(document);
        }

        return projects;
      })()
    `);
        if (!Array.isArray(rawProjects)) {
            throw new CliError('FETCH_ERROR', 'Failed to parse Gitee Explore page', 'Gitee may have changed its page structure');
        }
        const projects = rawProjects
            .map(toProject)
            .filter((project) => project !== null)
            .map((project) => mergeCapturedProject(project, projectsFromCapture.get(project.url)))
            .map((project) => ({
            ...project,
            description: compactDescription(project.description),
        }))
            .slice(0, limit);
        if (projects.length === 0) {
            throw new CliError('NOT_FOUND', 'No recommended projects found on Gitee Explore', 'Gitee may be blocking this request or the page structure changed');
        }
        return projects;
    },
});
