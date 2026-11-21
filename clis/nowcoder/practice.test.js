import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './practice.js';

const practice = getRegistry().get('nowcoder/practice');
const CAPTURE = JSON.parse(readFileSync(
    new URL('./__fixtures__/papers-practice.capture.json', import.meta.url),
    'utf8',
));

describe('nowcoder practice', () => {
    it('maps a captured career ID to questionJobId before loading progress', async () => {
        const fetchJson = vi.fn()
            .mockResolvedValueOnce({ success: true, code: 0, data: CAPTURE.tabs })
            .mockResolvedValueOnce({ success: true, code: 0, data: CAPTURE.practice });
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            fetchJson,
        };

        const rows = await practice.func(page, { job: '11226', limit: 20 });

        expect(page.goto).toHaveBeenCalledWith('https://www.nowcoder.com');
        expect(fetchJson.mock.calls[0][0]).toBe(
            'https://gw-c.nowcoder.com/api/sparta/question-tab/query-all-tab-list',
        );
        expect(fetchJson.mock.calls[1][0]).toBe(
            'https://gw-c.nowcoder.com/api/sparta/intelligent/getPCIntelligentList?questionJobId=10&isMember=false',
        );
        expect(rows).toEqual([{
            category: 'Captured category',
            tag_id: '273590',
            id: '1235',
            subject: 'Captured subject',
            total: 874,
            done: 0,
            remaining: 874,
        }]);
    });

    it('rejects unknown career IDs without a silent recommendation fallback', async () => {
        const fetchJson = vi.fn().mockResolvedValue({
            success: true,
            code: 0,
            data: CAPTURE.tabs,
        });
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            fetchJson,
        };

        await expect(practice.func(page, { job: '99999', limit: 20 }))
            .rejects.toBeInstanceOf(ArgumentError);
        expect(fetchJson).toHaveBeenCalledTimes(1);
    });

    it('validates job and limit before browser work', () => {
        expect(() => practice.validateArgs({ job: 'bad', limit: 20 })).toThrow(ArgumentError);
        expect(() => practice.validateArgs({ job: '11226', limit: 0 })).toThrow(ArgumentError);
    });
});
