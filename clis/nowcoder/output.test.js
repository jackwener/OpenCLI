import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { projectNowcoderDetail, projectNowcoderExperienceItem, projectNowcoderSearchItem } from './output.js';
import './detail.js';
import './experience.js';
import './search.js';

describe('Nowcoder lossless output projection', () => {
    it('keeps the complete detail body, stable identity, canonical URL, and timezone', () => {
        const longBody = `${'面试题'.repeat(220)}<br>最终结果`;
        const result = projectNowcoderDetail({
            uuid: 'post-uuid-1',
            title: '长面经',
            content: `<p>${longBody}</p>`,
            createdAt: '2026-01-01T12:00:00+08:00',
            userBrief: {
                userId: 'author-123',
                nickname: '牛客用户',
                educationInfo: '示例大学',
            },
            frequencyData: { likeCnt: 4, commentCnt: 3, viewCnt: 20 },
        });

        expect(result.content.length).toBeGreaterThan(500);
        expect(result.content).toContain('最终结果');
        expect(result).toMatchObject({
            id: 'post-uuid-1',
            url: 'https://www.nowcoder.com/discuss/post-uuid-1',
            author_id: 'author-123',
            author_url: 'https://www.nowcoder.com/users/author-123',
            time: '2026-01-01T04:00:00.000Z',
        });
    });

    it('adds stable author and post URLs to search output', () => {
        expect(projectNowcoderSearchItem({
            data: {
                momentData: { uuid: 'moment-1', title: '搜索结果', content: '<b>正文</b>' },
                userBrief: { userId: 42, nickname: 'Alice' },
            },
        }, 0)).toMatchObject({
            rank: 1,
            id: 'moment-1',
            url: 'https://www.nowcoder.com/discuss/moment-1',
            author_id: '42',
            author_url: 'https://www.nowcoder.com/users/42',
            content: '正文',
        });
    });

    it('adds stable author and post URLs to experience output', () => {
        expect(projectNowcoderExperienceItem({
            contentData: { uuid: 'experience-1', title: '一面复盘' },
            userBrief: { userId: 'user-7', nickname: 'Bob' },
            frequencyData: { likeCnt: 1, commentCnt: 2, viewCnt: 3 },
        }, 2)).toMatchObject({
            rank: 3,
            id: 'experience-1',
            url: 'https://www.nowcoder.com/discuss/experience-1',
            author_id: 'user-7',
            author_url: 'https://www.nowcoder.com/users/user-7',
        });
    });

    it('declares every identity field in the command columns', () => {
        for (const name of ['detail', 'search', 'experience']) {
            const columns = getRegistry().get(`nowcoder/${name}`)?.columns || [];
            expect(columns).toEqual(expect.arrayContaining(['id', 'url', 'author_id', 'author_url']));
        }
    });
});
