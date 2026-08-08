import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import {
    parseNowcoderPostTarget,
    projectNowcoderDetail,
    projectNowcoderFeedItem,
    projectNowcoderSearchItem,
} from './output.js';
import './detail.js';
import './experience.js';
import './search.js';

describe('Nowcoder post entity routing', () => {
    it('routes numeric content IDs and canonical discussion URLs to content detail', () => {
        expect(parseNowcoderPostTarget('912885704667987968')).toEqual({
            post_type: 'content',
            value: '912885704667987968',
        });
        expect(parseNowcoderPostTarget('https://www.nowcoder.com/discuss/912885704667987968?sourceSSR=search')).toEqual({
            post_type: 'content',
            value: '912885704667987968',
        });
    });

    it('routes moment UUIDs and canonical feed URLs to moment detail', () => {
        const uuid = '24e01f1d510a486b92efa795b4835669';
        expect(parseNowcoderPostTarget(uuid)).toEqual({ post_type: 'moment', value: uuid });
        expect(parseNowcoderPostTarget(`https://www.nowcoder.com/feed/main/detail/${uuid}`)).toEqual({
            post_type: 'moment',
            value: uuid,
        });
    });

    it('rejects non-canonical UUID discussion URLs instead of misrouting them', () => {
        expect(() => parseNowcoderPostTarget('https://www.nowcoder.com/discuss/162ac6f4410646009f97bf18012870c3'))
            .toThrow(/expected \/discuss\/<content-id>/);
    });
});

describe('Nowcoder detail projection', () => {
    it('keeps complete long-form content and uses createTime', () => {
        const longBody = `${'面试题'.repeat(220)}<br>最终结果`;
        const result = projectNowcoderDetail({
            id: '912885704667987968',
            uuid: '162ac6f4410646009f97bf18012870c3',
            entityId: 1662830,
            title: '长面经',
            content: `<p>${longBody}</p>`,
            createTime: Date.parse('2026-08-01T12:00:00+08:00'),
            userBrief: { userId: 646661816, nickname: '内容作者', educationInfo: '示例大学' },
            frequencyData: { likeCnt: 4, commentCnt: 3, viewCnt: 20 },
        }, 'content');

        expect(result.content.length).toBeGreaterThan(500);
        expect(result.content).toContain('最终结果');
        expect(result).toMatchObject({
            post_type: 'content',
            id: '912885704667987968',
            uuid: '162ac6f4410646009f97bf18012870c3',
            entity_id: '1662830',
            url: 'https://www.nowcoder.com/discuss/912885704667987968',
            author_id: '646661816',
            author_url: 'https://www.nowcoder.com/users/646661816',
            time: '2026-08-01T04:00:00.000Z',
        });
    });

    it('uses the moment UUID route and createdAt', () => {
        const uuid = '24e01f1d510a486b92efa795b4835669';
        expect(projectNowcoderDetail({
            id: 2882961,
            uuid,
            entityId: 2882961,
            title: '一面记录',
            content: '完整记录',
            createdAt: Date.parse('2026-08-01T20:00:00+08:00'),
            userBrief: { userId: 125006155, nickname: '动态作者' },
        }, 'moment')).toMatchObject({
            post_type: 'moment',
            id: uuid,
            uuid,
            entity_id: '2882961',
            url: `https://www.nowcoder.com/feed/main/detail/${uuid}`,
            time: '2026-08-01T12:00:00.000Z',
        });
    });
});

describe('Nowcoder mixed feed projection', () => {
    const contentItem = {
        contentId: '912885704667987968',
        contentData: {
            id: '912885704667987968',
            uuid: '162ac6f4410646009f97bf18012870c3',
            entityId: 1662830,
            title: '长文章',
        },
        userBrief: { userId: 646661816, nickname: '内容作者' },
        frequencyData: { viewCnt: 10 },
    };
    const momentItem = {
        contentId: '2882961',
        momentData: {
            id: 2882961,
            uuid: '24e01f1d510a486b92efa795b4835669',
            title: '短动态',
        },
        userBrief: { userId: 125006155, nickname: '动态作者' },
        frequencyData: { viewCnt: 5 },
    };

    it('returns round-trippable IDs and URLs for both entities in experience', () => {
        expect(projectNowcoderFeedItem(contentItem, 0)).toMatchObject({
            post_type: 'content',
            id: '912885704667987968',
            entity_id: '1662830',
            url: 'https://www.nowcoder.com/discuss/912885704667987968',
        });
        expect(projectNowcoderFeedItem(momentItem, 1)).toMatchObject({
            post_type: 'moment',
            id: '24e01f1d510a486b92efa795b4835669',
            entity_id: '2882961',
            url: 'https://www.nowcoder.com/feed/main/detail/24e01f1d510a486b92efa795b4835669',
        });
    });

    it('returns the same entity-aware shape from search records', () => {
        expect(projectNowcoderSearchItem({ data: contentItem }, 0)).toMatchObject({
            post_type: 'content',
            id: '912885704667987968',
            uuid: '162ac6f4410646009f97bf18012870c3',
        });
        expect(projectNowcoderSearchItem({ data: momentItem }, 1)).toMatchObject({
            post_type: 'moment',
            id: '24e01f1d510a486b92efa795b4835669',
            uuid: '24e01f1d510a486b92efa795b4835669',
        });
    });

    it('declares the entity and identity fields in all command outputs', () => {
        for (const name of ['detail', 'search', 'experience']) {
            const columns = getRegistry().get(`nowcoder/${name}`)?.columns || [];
            expect(columns).toEqual(expect.arrayContaining([
                'post_type', 'id', 'uuid', 'entity_id', 'url', 'author_id', 'author_url',
            ]));
        }
    });
});
