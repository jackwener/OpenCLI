import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { executePipeline } from '@jackwener/opencli/pipeline';
import { getRegistry } from '@jackwener/opencli/registry';
import './salary.js';

const salary = getRegistry().get('nowcoder/salary');
const CAPTURE = JSON.parse(readFileSync(
    new URL('./__fixtures__/salary.capture.json', import.meta.url),
    'utf8',
));

function pipelinePage(fetch) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn(code => runInContext(code, createContext({ fetch }))),
    };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('nowcoder salary', () => {
    it('preserves blank-title rows, full salary cards, and contiguous ranks', async () => {
        const fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            statusText: 'OK',
            json: vi.fn().mockResolvedValue({
                success: true,
                code: 0,
                data: {
                    records: [{ unsupported: true }, ...CAPTURE.records],
                },
            }),
        });

        const rows = await executePipeline(pipelinePage(fetch), salary.pipeline, {
            args: { page: 1, limit: 15 },
        });

        expect(fetch.mock.calls[0][0]).toBe(
            'https://gw-c.nowcoder.com/api/sparta/home/tab/content?tabId=858&categoryType=1&pageNo=1&pageSize=15',
        );
        expect(rows.map(row => row.rank)).toEqual([1, 2, 3, 4]);
        expect(rows.map(row => row.id)).toEqual([
            '00000000000000000000000000000562',
            '00000000000000000000000000000567',
            '0000000000000000000000000000056a',
            '0000000000000000000000000000053e',
        ]);
        expect(rows.map(row => row.title)).toEqual([
            'Captured salary title',
            'Second company / Second job / 18x15',
            'Third company / Third job / 16x14',
            'Captured long content',
        ]);
        expect(rows[1].salaryCard).toEqual(CAPTURE.records[1].salaryCard);
        expect(rows[1]).toMatchObject({
            company: 'Second company',
            job: 'Second job',
            salary: '18x15',
            city: 'Second city',
            education: 'Second degree',
            work_type: '',
            content: 'Captured blank-title body',
        });
        expect(salary.columns).not.toContain('salaryCard');
    });

    it('validates page and limit before browser work', () => {
        expect(() => salary.validateArgs({ page: 0, limit: 15 })).toThrow(ArgumentError);
        expect(() => salary.validateArgs({ page: 1, limit: 0 })).toThrow(ArgumentError);
    });

    it.each([6, 15])('applies --limit when the upstream endpoint returns 20 rows (limit %s)', async (limit) => {
        const records = Array.from({ length: 20 }, (_, index) => {
            const row = structuredClone(CAPTURE.records[index % 3]);
            row.momentData.uuid = `00000000000000000000000000000${String(600 + index).padStart(3, '0')}`;
            row.momentData.title = `Captured row ${index + 1}`;
            return row;
        });
        const fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            statusText: 'OK',
            json: vi.fn().mockResolvedValue({
                success: true,
                code: 0,
                data: { records },
            }),
        });

        const rows = await executePipeline(pipelinePage(fetch), salary.pipeline, {
            args: { page: 1, limit },
        });

        expect(fetch.mock.calls[0][0]).toContain(`pageSize=${limit}`);
        expect(rows).toHaveLength(limit);
        expect(rows.map(row => row.rank)).toEqual(Array.from({ length: limit }, (_, index) => index + 1));
    });
});
