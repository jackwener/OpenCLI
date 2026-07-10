import { describe, expect, it } from 'vitest';
import { __test__ } from './feedback.js';

describe('shein feedback adapter', () => {
    it('flattens SHEIN comment rows with labels and images', () => {
        const row = __test__.flattenSheinFeedbackComment({
            commentId: '18923882240',
            countrySiteCn: 'SHEIN日本站',
            supplierId: 11499497,
            goodsTitle: 'Kitchen Pot Rack',
            goodsThumb: '//img.ltwebstatic.com/thumb.jpg',
            goodsAttribute: 'Five-story Upgraded Version',
            goodsUrl: 'https://www.shein.com/item.html',
            goodSn: '20260424-厨具置物架',
            spu: 'h2604241745544459',
            skc: 'sh260424174554445992621',
            sku: 'I7mocu2qiy3ha8',
            goodsCommentStar: 5,
            goodsCommentStarName: '5星',
            goodsCommentContent: 'good',
            goodsCommentImages: ['//img.shein.com/a.jpg', { imgUrl: 'https://img.shein.com/b.jpg' }],
            logisticCommentStar: 4,
            logisticCommentContent: 'fast',
            commentTime: '2026-07-09 00:28',
            orderTime: '2026-07-05 22:16',
            billNo: 'GSH18W38A00NJ2D',
            memberOverallFitLabelList: [{ labelName: '合适' }, { name: '偏大' }],
            badCommentLabelList: [{ labelName: '破损' }, '异味'],
        });

        expect(row).toEqual({
            commentId: '18923882240',
            countrySiteCn: 'SHEIN日本站',
            supplierId: '11499497',
            goodsTitle: 'Kitchen Pot Rack',
            goodsThumb: 'https://img.ltwebstatic.com/thumb.jpg',
            goodsAttribute: 'Five-story Upgraded Version',
            goodsUrl: 'https://www.shein.com/item.html',
            goodSn: '20260424-厨具置物架',
            spu: 'h2604241745544459',
            skc: 'sh260424174554445992621',
            sku: 'I7mocu2qiy3ha8',
            goodsCommentStar: 5,
            goodsCommentStarName: '5星',
            goodsCommentContent: 'good',
            goodsCommentImages: ['https://img.shein.com/a.jpg', 'https://img.shein.com/b.jpg'],
            logisticCommentStar: 4,
            logisticCommentContent: 'fast',
            commentTime: '2026-07-09 00:28',
            orderTime: '2026-07-05 22:16',
            billNo: 'GSH18W38A00NJ2D',
            memberOverallFitLabelList: '合适,偏大',
            badCommentLabelList: '破损,异味',
        });
    });

    it('filters comments by normalized commentTime', () => {
        const comments = [
            { commentId: 'new', commentTime: '2026-07-09 00:28' },
            { commentId: 'same', commentTime: '2026-07-08 00:00' },
            { commentId: 'old', commentTime: '2026-07-07 23:59' },
        ];
        const result = __test__.filterCommentsByTime(comments, '2026-07-08 00:00:00', '');
        expect(result.comments.map((item) => item.commentId)).toEqual(['new']);
        expect(result.shouldStop).toBe(true);
    });

    it('builds paginated comment request bodies with flexible page keys', () => {
        expect(__test__.buildPaginatedCommentBody({ page: 1, perPage: 20 }, 2)).toMatchObject({ page: 2, perPage: 20 });
        expect(__test__.buildPaginatedCommentBody({ pageNum: 1, pageSize: 50 }, 3, 100)).toMatchObject({ pageNum: 3, pageSize: 100 });
        expect(__test__.buildPaginatedCommentBody({}, 4, 30)).toMatchObject({ page: 4, perPage: 30 });
    });

    it('injects comment time range into replayed list request bodies', () => {
        const body = __test__.buildCommentListBody(
            { page: 1, perPage: 30, startCommentTime: '2026-07-01 00:00:00' },
            2,
            {
                perPage: 50,
                sinceCommentTime: '2026-05-01 00:00:00',
                untilCommentTime: '2026-06-01 23:59:59',
            },
        );

        expect(body).toMatchObject({
            page: 2,
            perPage: 50,
            startCommentTime: '2026-05-01 00:00:00',
            commentEndTime: '2026-06-01 23:59:59',
        });
    });

    it('extracts comment/list capture context without replaying cookies', () => {
        const context = __test__.extractCommentListCaptureContext([
            {
                url: '/mgs-api-prefix/goods/comment/list',
                requestHeaders: {
                    Accept: '*/*',
                    Cookie: 'secret=1',
                    'Build-Version': '2026-07-09',
                    'X-Log-VisitorId': 'visitor',
                },
                requestBodyPreview: '{"page":1,"perPage":20}',
                responseStatus: 200,
                responsePreview: '{"code":"0","info":{"data":[{"commentId":"1"}],"meta":{"count":29}}}',
            },
        ]);

        expect(context.headers).toMatchObject({
            accept: '*/*',
            'build-version': '2026-07-09',
            'x-log-visitorid': 'visitor',
        });
        expect(context.headers).not.toHaveProperty('cookie');
        expect(context.body).toMatchObject({ page: 1, perPage: 20 });
        expect(context.response.info.data).toHaveLength(1);
    });

    it('normalizes compact date filters', () => {
        expect(__test__.normalizeCommentTimeInput('2026-7-8', '--sinceCommentTime')).toBe('2026-07-08 00:00:00');
        expect(__test__.normalizeCommentTimeInput('2026-7-8 1:2', '--sinceCommentTime')).toBe('2026-07-08 01:02:00');
    });
});
