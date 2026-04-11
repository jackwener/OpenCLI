import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { downloadScysCourseImagesInternal } from './course-download.js';
function makeRow(overrides) {
    return {
        course_title: 'Course',
        chapter_title: 'Chapter',
        breadcrumb: 'A > B > C',
        content: 'body',
        chapter_id: '1',
        course_id: '92',
        toc_summary: '',
        url: 'https://scys.com/course/detail/92?chapterId=1',
        raw_url: 'https://scys.com/course/detail/92?chapterId=1',
        updated_at_text: '',
        copyright_text: '',
        prev_chapter: '',
        next_chapter: '',
        participant_count: 0,
        discussion_hint: '',
        links: [],
        images: [],
        image_count: 0,
        content_images: [],
        content_image_count: 0,
        image_dir: '',
        ...overrides,
    };
}
describe('downloadScysCourseImagesInternal', () => {
    it('deduplicates repeated image urls across chapters and copies cached files', async () => {
        const output = fs.mkdtempSync(path.join(os.tmpdir(), 'scys-course-download-'));
        const rows = [
            makeRow({ chapter_id: '4038', images: ['https://cdn.example.com/shared.png', 'https://cdn.example.com/unique-a.png'] }),
            makeRow({ chapter_id: '4039', images: ['https://cdn.example.com/shared.png'] }),
        ];
        const calls = [];
        const result = await downloadScysCourseImagesInternal(rows, output, 'cookie=a', {
            concurrency: 2,
            downloadToPath: async (url, destPath) => {
                calls.push(url);
                await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
                await fs.promises.writeFile(destPath, `downloaded:${url}`);
                return true;
            },
        });
        expect(calls).toEqual([
            'https://cdn.example.com/shared.png',
            'https://cdn.example.com/unique-a.png',
        ]);
        expect(result[0]?.image_count).toBe(2);
        expect(result[1]?.image_count).toBe(1);
        expect(fs.existsSync(path.join(output, '92', '4038', '92_4038_1.png'))).toBe(true);
        expect(fs.existsSync(path.join(output, '92', '4038', '92_4038_2.png'))).toBe(true);
        expect(fs.existsSync(path.join(output, '92', '4039', '92_4039_1.png'))).toBe(true);
    });
    it('downloads unique image urls concurrently instead of one-by-one', async () => {
        const output = fs.mkdtempSync(path.join(os.tmpdir(), 'scys-course-download-'));
        const rows = [
            makeRow({ chapter_id: '4038', images: ['https://cdn.example.com/a.png', 'https://cdn.example.com/b.png'] }),
            makeRow({ chapter_id: '4039', images: ['https://cdn.example.com/c.png', 'https://cdn.example.com/d.png'] }),
        ];
        let active = 0;
        let maxActive = 0;
        await downloadScysCourseImagesInternal(rows, output, 'cookie=a', {
            concurrency: 3,
            downloadToPath: async (_url, destPath) => {
                active += 1;
                maxActive = Math.max(maxActive, active);
                await new Promise((resolve) => setTimeout(resolve, 30));
                await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
                await fs.promises.writeFile(destPath, 'x');
                active -= 1;
                return true;
            },
        });
        expect(maxActive).toBeGreaterThan(1);
    });
});
