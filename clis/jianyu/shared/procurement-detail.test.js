import { describe, expect, it } from 'vitest';
import { runProcurementDetail } from './procurement-detail.js';
function createPage(evaluateImpl) {
    return {
        goto: async () => { },
        wait: async () => { },
        evaluate: async () => evaluateImpl(),
    };
}
describe('procurement detail runner', () => {
    it('retries transient execution-context errors and succeeds', async () => {
        let attempts = 0;
        const page = createPage(async () => {
            attempts += 1;
            if (attempts < 3) {
                throw new Error('Execution context was destroyed.');
            }
            return {
                title: '电梯采购公告',
                detailText: '项目编号：ABC-100 预算金额：100万元 截止时间：2026-04-30',
                publishTime: '2026-04-09',
            };
        });
        const rows = await runProcurementDetail(page, {
            url: 'https://example.com/jybx/20260409_1.html',
            site: 'jianyu',
            query: '电梯',
        });
        expect(attempts).toBe(3);
        expect(rows).toHaveLength(1);
        expect(rows[0].title).toContain('电梯采购公告');
    });
    it('retries empty_result once and succeeds on the next attempt', async () => {
        let attempts = 0;
        const page = createPage(async () => {
            attempts += 1;
            if (attempts === 1) {
                return {
                    title: '',
                    detailText: '',
                    publishTime: '',
                };
            }
            return {
                title: '防爆电梯采购公告',
                detailText: '采购内容：防爆电梯2台。',
                publishTime: '2026-03-10',
            };
        });
        const rows = await runProcurementDetail(page, {
            url: 'https://example.com/jybx/20260310_1.html',
            site: 'jianyu',
            query: '防爆电梯',
        });
        expect(attempts).toBe(2);
        expect(rows).toHaveLength(1);
        expect(rows[0].title).toContain('防爆电梯');
    });
    it('does not retry non-retryable extraction_drift errors', async () => {
        let attempts = 0;
        const page = createPage(async () => {
            attempts += 1;
            return null;
        });
        await expect(runProcurementDetail(page, {
            url: 'https://example.com/jybx/20260310_1.html',
            site: 'jianyu',
            query: '电梯',
        })).rejects.toThrow('[taxonomy=extraction_drift]');
        expect(attempts).toBe(1);
    });
    it('rejects captcha/verification pages as selector_drift', async () => {
        const page = createPage(async () => ({
            title: '验证码',
            detailText: '请在下图依次点击：槨畽黛',
            publishTime: '',
        }));
        await expect(runProcurementDetail(page, {
            url: 'https://www.jianyu360.cn/nologin/content/ABC.html',
            site: 'jianyu',
            query: '电梯',
        })).rejects.toThrow('[taxonomy=selector_drift]');
    });
});
