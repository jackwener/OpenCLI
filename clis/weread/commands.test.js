import { describe, expect, it } from 'vitest';

import { extractReaderFallbackMetadata, strictTitleFromWereadDocumentTitle } from './book.js';
describe('weread reader fallback metadata', () => {
    it('does not guess author from document.title when the reader page skips cover metadata', async () => {
        const nodes = new Map([
            ['.readerTopBar_title_link', { textContent: 'Part 1 - Part 2' }],
            ['.introDialog_content_pub_line', { textContent: '出版社 测试出版社' }],
            ['.introDialog_content_intro_para', { textContent: '测试简介。' }],
        ]);
        const mockDocument = {
            title: 'Part 1 - Part 2 - 作者甲 - 微信读书',
            body: { innerText: '微信读书推荐值 88.8%' },
            scripts: [],
            querySelector: (selector) => nodes.get(selector) || null,
        };
        expect(strictTitleFromWereadDocumentTitle(mockDocument.title)).toBe('');
        expect(extractReaderFallbackMetadata(mockDocument)).toEqual({
            title: 'Part 1 - Part 2',
            author: '',
            publisher: '测试出版社',
            intro: '测试简介。',
            category: '',
            rating: '88.8%',
            metadataReady: true,
        });
    });

});
