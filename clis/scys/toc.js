import { cli, Strategy } from '@jackwener/opencli/registry';
import { extractScysToc } from './extractors.js';
cli({
    site: 'scys',
    name: 'toc',
    description: 'Extract chapter table of contents from a SCYS course',
    domain: 'scys.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    args: [
        { name: 'course', required: true, positional: true, help: 'Course URL or numeric course id' },
        { name: 'wait', type: 'int', default: 2, help: 'Seconds to wait after page load' },
    ],
    columns: ['rank', 'entry_type', 'section', 'group', 'chapter_id', 'chapter_title', 'status', 'is_current'],
    func: async (page, kwargs) => {
        return extractScysToc(page, String(kwargs.course), {
            waitSeconds: Number(kwargs.wait ?? 2),
        });
    },
});
