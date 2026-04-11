import { describe, expect, it } from 'vitest';
import { buildScysCourseChapterUrls, normalizeScysCoursePayload, repairScysBrokenUrls, summarizeScysToc, } from './course-utils.js';
describe('repairScysBrokenUrls', () => {
    it('repairs spaced and split urls in extracted course text', () => {
        const input = [
            '工具地址：http ://raphael.app',
            '编辑器：http ://www.cur or.com/',
            '注册页：http ://github.com/ ignup',
            '平台：http :// iliconflow.cn/',
        ].join(' ');
        expect(repairScysBrokenUrls(input)).toContain('http://raphael.app');
        expect(repairScysBrokenUrls(input)).toContain('http://www.cursor.com/');
        expect(repairScysBrokenUrls(input)).toContain('http://github.com/signup');
        expect(repairScysBrokenUrls(input)).toContain('http://siliconflow.cn/');
    });
});
describe('normalizeScysCoursePayload', () => {
    it('prefers the content title over a stale active chapter when chapterId is explicit', () => {
        const result = normalizeScysCoursePayload({
            courseTitle: '【深海圈】AI产品出海',
            chapterTitle: '课程目标',
            currentChapter: '课程前言',
            breadcrumb: ['预备篇', '图文', '课程前言'],
            content: '课程目标：正本清源',
            chapterId: '4038',
            pageUrl: 'https://scys.com/course/detail/92?chapterId=4038',
            images: [
                'https://cdn.example.com/cover.jpg',
                '/assets/logo.png',
                'data:image/png;base64,abc',
                '/images/pic_empty.png',
            ],
            contentImages: ['https://cdn.example.com/content-1.jpg'],
            updatedAtText: '更新于：2025.12.02 08:03',
            copyrightText: '版权归生财有术及手册出品人所有',
            prevChapter: '上一节 课程前言',
            nextChapter: '下一节 基础篇',
            participantText: '146人参与',
            discussionHint: '发起讨论',
            links: [' https://scys.com/course/detail/92?chapterId=4038 ', 'https://example.com/a '],
            tocRows: [
                { section: '预备篇', group: '图文', chapter_id: '4137', chapter_title: '课程前言', status: '737人学过', is_current: false, rank: 1, entry_type: 'chapter' },
                { section: '预备篇', group: '图文', chapter_id: '4038', chapter_title: '课程目标', status: '508人学过', is_current: true, rank: 2, entry_type: 'chapter' },
            ],
        });
        expect(result.chapter_title).toBe('课程目标');
        expect(result.breadcrumb).toBe('预备篇 > 图文 > 课程目标');
        expect(result.updated_at_text).toBe('更新于：2025.12.02 08:03');
        expect(result.participant_count).toBe(146);
        expect(result.image_count).toBe(2);
        expect(result.images).toEqual(['https://cdn.example.com/cover.jpg', 'https://scys.com/assets/logo.png']);
        expect(result.content_image_count).toBe(1);
        expect(result.links).toEqual([
            'https://scys.com/course/detail/92?chapterId=4038',
            'https://example.com/a',
        ]);
    });
    it('prefers toc-based section and group when breadcrumb is polluted by sidebar state', () => {
        const result = normalizeScysCoursePayload({
            courseTitle: '【深海圈】AI产品出海',
            chapterTitle: '课程前言',
            breadcrumb: ['问答（持续更新）', '图文', '课程前言'],
            content: '课程前言正文',
            chapterId: '4137',
            pageUrl: 'https://scys.com/course/detail/92?chapterId=4137',
            tocRows: [
                { section: '预备篇', group: '图文', chapter_id: '4137', chapter_title: '课程前言', status: '737人学过', is_current: false, rank: 1, entry_type: 'chapter' },
            ],
        });
        expect(result.breadcrumb).toBe('预备篇 > 图文 > 课程前言');
    });
});
describe('summarizeScysToc', () => {
    it('includes all visible groups and chapters in the summary', () => {
        expect(summarizeScysToc([
            { rank: 1, entry_type: 'chapter', section: '预备篇', group: '图文', chapter_id: '4137', chapter_title: '课程前言', status: '', is_current: false },
            { rank: 2, entry_type: 'chapter', section: '预备篇', group: '图文', chapter_id: '4038', chapter_title: '课程目标', status: '', is_current: true },
            { rank: 3, entry_type: 'section', section: '基础篇', group: '基础篇', chapter_id: '', chapter_title: '基础篇', status: '', is_current: false },
        ])).toBe('1.预备篇 > 图文/课程前言(4137) | 2.预备篇 > 图文/课程目标(4038) | 3.基础篇');
    });
});
describe('buildScysCourseChapterUrls', () => {
    it('builds deterministic chapter urls from toc rows', () => {
        expect(buildScysCourseChapterUrls('https://scys.com/course/detail/92', [
            { rank: 1, entry_type: 'section', section: '预备篇', group: '预备篇', chapter_id: '', chapter_title: '预备篇', status: '', is_current: false },
            { rank: 2, entry_type: 'chapter', section: '预备篇', group: '图文', chapter_id: '4137', chapter_title: '课程前言', status: '', is_current: false },
            { rank: 3, entry_type: 'chapter', section: '预备篇', group: '图文', chapter_id: '4038', chapter_title: '课程目标', status: '', is_current: true },
        ])).toEqual([
            'https://scys.com/course/detail/92?chapterId=4137',
            'https://scys.com/course/detail/92?chapterId=4038',
        ]);
    });
});
