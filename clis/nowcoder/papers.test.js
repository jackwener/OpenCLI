import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { executePipeline } from '@jackwener/opencli/pipeline';
import { getRegistry } from '@jackwener/opencli/registry';
import './papers.js';

const papers = getRegistry().get('nowcoder/papers');
const CAPTURE = JSON.parse(readFileSync(
    new URL('./__fixtures__/papers-practice.capture.json', import.meta.url),
    'utf8',
));

function pipelinePage(fetch) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn(code => runInContext(code, createContext({ fetch }))),
    };
}

describe('nowcoder papers', () => {
    it('sends array filters and preserves captured paper IDs', async () => {
        const fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            statusText: 'OK',
            json: vi.fn().mockResolvedValue({
                success: true,
                code: 0,
                data: CAPTURE.papers,
            }),
        });

        const rows = await executePipeline(pipelinePage(fetch), papers.pipeline, {
            args: { job: '11002', company: '239', limit: 10 },
        });

        expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
            order: 0,
            page: 1,
            pageSize: 10,
            careerJob: 11226,
            jobIds: [11002],
            companyIds: [239],
            query: '',
        });
        expect(rows).toEqual([
            { rank: 1, id: '1263', title: 'Captured paper', company: 'Captured company', practitioners: 926 },
            { rank: 2, id: '1264', title: 'Second captured paper', company: 'Captured company', practitioners: 988 },
        ]);
    });

    it('validates job, company, and limit before browser work', () => {
        expect(() => papers.validateArgs({ job: 'bad', company: '', limit: 10 })).toThrow(ArgumentError);
        expect(() => papers.validateArgs({ job: '11002', company: 'bad', limit: 10 })).toThrow(ArgumentError);
        expect(() => papers.validateArgs({ job: '11002', company: '', limit: 0 })).toThrow(ArgumentError);
    });
});
