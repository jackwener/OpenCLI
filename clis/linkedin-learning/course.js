/**
 * LinkedIn Learning course detail by slug, via /learning-api/courses?q=slug.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { DOMAIN, fetchLinkedInLearningApi, normalizeWhitespace } from './shared.js';

function parseSlug(value) {
    const s = normalizeWhitespace(value);
    if (!s) throw new ArgumentError('<slug> is required');
    let slug = s;
    if (/^https?:\/\//i.test(s)) {
        let parsed;
        try {
            parsed = new URL(s);
        } catch {
            throw new ArgumentError(`Invalid LinkedIn Learning URL: "${s}"`);
        }
        const host = parsed.hostname.toLowerCase();
        if (host !== 'linkedin.com' && host !== 'www.linkedin.com') {
            throw new ArgumentError(`Invalid LinkedIn Learning host: "${parsed.hostname}"`);
        }
        const m = parsed.pathname.match(/^\/learning\/([^/?#]+)/);
        if (!m) throw new ArgumentError(`Invalid LinkedIn Learning course URL: "${s}"`);
        slug = m[1];
    } else {
        const m = s.match(/^\/?learning\/([^/?#]+)/);
        slug = m ? m[1] : s;
    }
    if (!/^[a-zA-Z0-9-_]+$/.test(slug)) {
        throw new ArgumentError(`Invalid LinkedIn Learning slug: "${slug}"`);
    }
    return slug;
}

function parseCourse(el, slug) {
    const title = normalizeWhitespace(el?.title);
    if (!title) return null;
    const description = typeof el?.description === 'string'
        ? el.description
        : (el?.description?.text || '');
    const duration = el?.duration?.unit === 'SECOND' ? String(el.duration.duration ?? '') : '';
    const released = el?.activatedAt ? new Date(el.activatedAt).toISOString().slice(0, 10) : '';
    return {
        title,
        slug,
        description,
        difficulty: el?.difficultyLevel || '',
        duration_sec: duration,
        videos_count: el?.videosCount ?? '',
        rating: typeof el?.rating?.averageRating === 'number' ? el.rating.averageRating.toFixed(2) : '',
        rating_count: el?.rating?.ratingCount ?? '',
        released,
        url: `https://www.linkedin.com/learning/${slug}`,
    };
}

cli({
    site: 'linkedin-learning',
    name: 'course',
    access: 'read',
    description: 'Get LinkedIn Learning course detail by slug or course URL',
    domain: DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'slug', type: 'string', required: true, positional: true, help: 'Course slug (e.g. agentic-ai-build-your-first-agentic-ai-system) or full /learning/<slug> URL' },
    ],
    columns: ['title', 'slug', 'description', 'difficulty', 'duration_sec', 'videos_count', 'rating', 'rating_count', 'released', 'url'],
    func: async (page, args) => {
        if (!page) throw new CommandExecutionError('Browser session required for linkedin-learning course');
        const slug = parseSlug(args.slug);

        const url = `https://www.linkedin.com/learning-api/courses?q=slug&slug=${encodeURIComponent(slug)}`;
        const result = await fetchLinkedInLearningApi(page, url);
        if (!result?.json) {
            throw new CommandExecutionError(`LinkedIn Learning courses lookup failed: ${result?.error ?? 'no payload'}`);
        }
        const elements = result.json?.elements;
        if (!Array.isArray(elements)) {
            throw new CommandExecutionError('LinkedIn Learning courses lookup returned malformed payload: missing elements array');
        }
        const el = elements[0];
        if (!el) {
            throw new EmptyResultError(`No LinkedIn Learning course found for slug "${slug}"`);
        }
        const row = parseCourse(el, slug);
        if (!row) {
            throw new CommandExecutionError('LinkedIn Learning courses lookup returned malformed course detail: missing title');
        }
        return [row];
    },
});

export const __test__ = { parseSlug, parseCourse };
