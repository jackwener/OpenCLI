import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './ask.js';
import './new.js';
import './send.js';
import './read.js';
import './status.js';
import './model.js';

describe('chatgpt-app desktop command registration', () => {
    it('registers the baseline desktop chat commands with localhost scope', () => {
        const expectedAccess = {
            ask: 'write',
            send: 'write',
            read: 'read',
            new: 'write',
            status: 'read',
            model: 'read',
        };

        for (const [name, access] of Object.entries(expectedAccess)) {
            const cmd = getRegistry().get(`chatgpt-app/${name}`);
            expect(cmd, `chatgpt-app/${name}`).toBeDefined();
            expect(cmd.site).toBe('chatgpt-app');
            expect(cmd.domain).toBe('localhost');
            expect(cmd.strategy).toBe('public');
            expect(cmd.browser).toBe(false);
            expect(cmd.access).toBe(access);
        }
    });

    it('defines the --temp boolean argument in the new command', () => {
        const newCmd = getRegistry().get('chatgpt-app/new');
        expect(newCmd.args).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'temp', type: 'boolean', default: false }),
        ]));
    });

    it('defines the --image argument in the ask command', () => {
        const askCmd = getRegistry().get('chatgpt-app/ask');
        expect(askCmd.args).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'image', required: false }),
        ]));
    });
});
