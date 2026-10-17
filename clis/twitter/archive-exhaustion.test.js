import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './bookmarks.js';
import './likes.js';

for (const source of ['likes', 'bookmarks']) {
    describe(`twitter ${source} repeated cursor exhaustion`, () => {
        it.each(['empty', 'duplicate', 'new', 'unknown'])('handles a %s page without losing resume state', async (kind) => {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-archive-end-'));
            const outputFile = path.join(root, 'archive.jsonl');
            const resumeFile = path.join(root, 'resume.json');
            fs.writeFileSync(outputFile, '{"id":"1"}\n');
            fs.writeFileSync(resumeFile, JSON.stringify({ cursor: 'END', count: 1, complete: false, source, username: 'viewer', outputFile }));
            const cursor = { entryId: 'cursor-bottom-1', content: { entryType: 'TimelineTimelineCursor', cursorType: 'Bottom', value: 'END', stopOnEmptyResponse: true } };
            const entry = kind === 'unknown' ? { entryId: 'new-shape', content: { unsupported: true } }
                : { entryId: 'tweet', content: { itemContent: { tweet_results: { result: { rest_id: kind === 'new' ? '2' : '1', legacy: { full_text: 'fixture' } } } } } };
            const instructions = [{ entries: kind === 'empty' ? [cursor] : [entry, cursor] }];
            const payload = source === 'likes'
                ? { data: { user: { result: { timeline_v2: { timeline: { instructions } } } } } }
                : { data: { bookmark_timeline_v2: { timeline: { instructions } } } };
            const page = {
                getCookies: vi.fn(async () => [{ name: 'ct0', value: 'fixture' }]),
                evaluate: vi.fn(async (script) => {
                    if (script.includes('operationName') || script.includes('queryId')) return null;
                    if (script.includes('/UserByScreenName')) return '42';
                    if (script.includes('/Likes') || script.includes('/Bookmarks')) return payload;
                    throw new Error('Unexpected script');
                }),
            };
            try {
                const run = getRegistry().get(`twitter/${source}`).func(page, { username: 'viewer', all: true, 'max-pages': 2, 'resume-file': resumeFile, 'output-file': outputFile });
                if (kind === 'empty') {
                    await expect(run).resolves.toMatchObject({ complete: true, count: 1, pages: 1 });
                    expect(fs.existsSync(resumeFile)).toBe(false);
                } else {
                    await expect(run).rejects.toThrow('repeated_cursor');
                    expect(JSON.parse(fs.readFileSync(resumeFile, 'utf8'))).toMatchObject({ complete: false, cursor: 'END', count: kind === 'new' ? 2 : 1 });
                }
                expect(fs.readFileSync(outputFile, 'utf8').trim().split('\n')).toHaveLength(kind === 'new' ? 2 : 1);
            } finally { fs.rmSync(root, { recursive: true, force: true }); }
        });
    });
}
