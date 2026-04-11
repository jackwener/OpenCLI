import { cli, Strategy } from '@jackwener/opencli/registry';
import { downloadScysCourseImages } from './course-download.js';
import { extractScysCourse, extractScysCourseAll } from './extractors.js';
cli({
    site: 'scys',
    name: 'course',
    description: 'Read SCYS course detail content and chapter context',
    domain: 'scys.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    args: [
        { name: 'url', required: true, positional: true, help: 'Course URL: /course/detail/:id[?chapterId=...]' },
        { name: 'wait', type: 'int', default: 3, help: 'Seconds to wait after page load' },
        { name: 'max-length', type: 'int', default: 4000, help: 'Max content length' },
        { name: 'all', type: 'boolean', default: false, help: 'Export all deterministic chapter ids from TOC' },
        { name: 'download-images', type: 'boolean', default: false, help: 'Download course page images to local directory' },
        { name: 'output', default: './scys-course-downloads', help: 'Image output directory' },
    ],
    columns: [
        'course_title',
        'chapter_title',
        'breadcrumb',
        'updated_at_text',
        'participant_count',
        'image_count',
        'content_image_count',
        'prev_chapter',
        'next_chapter',
        'chapter_id',
        'course_id',
        'url',
        'image_dir',
    ],
    func: async (page, kwargs) => {
        const all = kwargs.all === true || String(kwargs.all) === 'true';
        const data = all
            ? await extractScysCourseAll(page, String(kwargs.url), {
                waitSeconds: Number(kwargs.wait ?? 3),
                maxLength: Number(kwargs['max-length'] ?? 4000),
            })
            : await extractScysCourse(page, String(kwargs.url), {
                waitSeconds: Number(kwargs.wait ?? 3),
                maxLength: Number(kwargs['max-length'] ?? 4000),
            });
        const downloadImages = kwargs['download-images'] === true || String(kwargs['download-images']) === 'true';
        if (!downloadImages)
            return data;
        return downloadScysCourseImages(page, data, String(kwargs.output ?? './scys-course-downloads'));
    },
});
