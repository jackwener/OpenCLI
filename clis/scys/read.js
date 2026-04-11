import { ArgumentError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { downloadScysCourseImages } from './course-download.js';
import { detectScysPageType, inferScysReadUrl } from './common.js';
import { extractScysActivity, extractScysArticle, extractScysCourse, extractScysCourseAll, extractScysFeed, extractScysOpportunity, } from './extractors.js';
cli({
    site: 'scys',
    name: 'read',
    description: 'Read a SCYS page with automatic page-type routing',
    domain: 'scys.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    args: [
        { name: 'url', required: true, positional: true, help: 'Any scys.com URL' },
        { name: 'wait', type: 'int', default: 3, help: 'Seconds to wait after page load' },
        { name: 'limit', type: 'int', default: 20, help: 'Max rows for list pages' },
        { name: 'max-length', type: 'int', default: 4000, help: 'Max content length for long text fields' },
        { name: 'all', type: 'boolean', default: false, help: 'For course pages, export all deterministic chapter ids from TOC' },
        { name: 'download-images', type: 'boolean', default: false, help: 'For course pages, download page images to local directory' },
        { name: 'output', default: './scys-course-downloads', help: 'Image output directory for course pages' },
    ],
    func: async (page, kwargs) => {
        const url = inferScysReadUrl(String(kwargs.url));
        const waitSeconds = Math.max(1, Number(kwargs.wait ?? 3));
        const limit = Math.max(1, Number(kwargs.limit ?? 20));
        const maxLength = Math.max(300, Number(kwargs['max-length'] ?? 4000));
        const all = kwargs.all === true || String(kwargs.all) === 'true';
        const downloadImages = kwargs['download-images'] === true || String(kwargs['download-images']) === 'true';
        const pageType = detectScysPageType(url);
        if (pageType === 'course') {
            const extracted = all
                ? await extractScysCourseAll(page, url, { waitSeconds, maxLength })
                : await extractScysCourse(page, url, { waitSeconds, maxLength });
            const data = downloadImages
                ? await downloadScysCourseImages(page, extracted, String(kwargs.output ?? './scys-course-downloads'))
                : extracted;
            return { page_type: pageType, data };
        }
        if (pageType === 'feed') {
            const data = await extractScysFeed(page, url, { waitSeconds, limit, maxLength });
            return { page_type: pageType, data };
        }
        if (pageType === 'opportunity') {
            const data = await extractScysOpportunity(page, url, { waitSeconds, limit, maxLength });
            return { page_type: pageType, data };
        }
        if (pageType === 'activity') {
            const data = await extractScysActivity(page, url, { waitSeconds, maxLength });
            return { page_type: pageType, data };
        }
        if (pageType === 'article') {
            const data = await extractScysArticle(page, url, { waitSeconds, maxLength });
            return { page_type: pageType, data };
        }
        throw new ArgumentError(`Unsupported SCYS page for scys/read: ${url}`, 'Supported patterns: /course/detail/:id, /?filter=essence, /personal/:id?tab=posts, /opportunity, /activity/landing/:id, /articleDetail/:entityType/:topicId');
    },
});
