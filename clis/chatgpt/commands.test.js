import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './ask.js';
import './send.js';
import './read.js';
import './history.js';
import './detail.js';
import './new.js';
import './status.js';
import './image.js';

describe('chatgpt browser command registration', () => {
    it('registers the baseline web chat commands with site-level reuse', () => {
        const expectedAccess = {
            ask: 'write',
            send: 'write',
            read: 'read',
            history: 'read',
            detail: 'read',
            new: 'read',
            status: 'read',
            image: 'write',
        };

        for (const [name, access] of Object.entries(expectedAccess)) {
            const cmd = getRegistry().get(`chatgpt/${name}`);
            expect(cmd, `chatgpt/${name}`).toBeDefined();
            expect(cmd.site).toBe('chatgpt');
            expect(cmd.domain).toBe('chatgpt.com');
            expect(cmd.strategy).toBe('cookie');
            expect(cmd.browser).toBe(true);
            expect(cmd.browserSession).toEqual({ reuse: 'site' });
            expect(cmd.navigateBefore).toBe(false);
            expect(cmd.access).toBe(access);
        }
    });

    it('keeps ask timeout as the runtime-visible integer timeout arg', () => {
        const ask = getRegistry().get('chatgpt/ask');
        expect(ask.args).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'timeout', type: 'int', default: 120 }),
            expect.objectContaining({ name: 'new', type: 'boolean', default: false }),
        ]));
    });
});
