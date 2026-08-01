import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { projectNowcoderMetrics } from './metrics.js';
import './detail.js';

describe('Nowcoder interaction metrics', () => {
    it('preserves real zero counts as available numbers', () => {
        expect(projectNowcoderMetrics({
            likeCnt: 0,
            followCnt: 0,
            commentCnt: 0,
            shareCnt: 0,
            viewCnt: 0,
        })).toEqual({
            likes: 0,
            likes_status: 'available',
            collects: 0,
            collects_status: 'available',
            comments: 0,
            comments_status: 'available',
            shares: 0,
            shares_status: 'available',
            views: 0,
            views_status: 'available',
        });
    });

    it('projects the public collect and share counts exposed by Nowcoder', () => {
        expect(projectNowcoderMetrics({
            likeCnt: 49,
            followCnt: 18,
            commentCnt: 83,
            totalCommentCnt: 105,
            shareCnt: 2,
            viewCnt: 14369,
        })).toMatchObject({
            likes: 49,
            collects: 18,
            comments: 83,
            shares: 2,
            views: 14369,
        });
    });

    it('uses null plus unavailable instead of inventing zero for absent metrics', () => {
        expect(projectNowcoderMetrics({
            likeCnt: -1,
            commentCnt: null,
            totalCommentCnt: '7',
            viewCnt: 'not-a-number',
        })).toEqual({
            likes: null,
            likes_status: 'unavailable',
            collects: null,
            collects_status: 'unavailable',
            comments: 7,
            comments_status: 'available',
            shares: null,
            shares_status: 'unavailable',
            views: null,
            views_status: 'unavailable',
        });
    });

    it('remains self-contained when serialized for browser evaluation', () => {
        const serialized = Function(`return (${projectNowcoderMetrics.toString()})`)();
        expect(serialized({ likeCnt: 0, followCnt: 3, shareCnt: 1 })).toMatchObject({
            likes: 0,
            likes_status: 'available',
            collects: 3,
            collects_status: 'available',
            shares: 1,
            shares_status: 'available',
        });
    });

    it('declares every metric value and status in detail output', () => {
        const columns = getRegistry().get('nowcoder/detail')?.columns || [];
        expect(columns).toEqual(expect.arrayContaining([
            'likes', 'likes_status',
            'collects', 'collects_status',
            'comments', 'comments_status',
            'shares', 'shares_status',
            'views', 'views_status',
        ]));
    });
});
