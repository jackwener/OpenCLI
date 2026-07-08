import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { evaluateQoder, parsePositiveInt, QODER_TURNS_JS, requireArrayResult } from './_utils.js';

cli({
    site: 'qoder',
    name: 'read',
    access: 'read',
    description: 'Read messages in the current Qoder Quest. Returns role + text for each visible turn.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'limit', type: 'int', required: false, default: 30 },
    ],
    columns: ['Index', 'Role', 'Text'],
    func: async (page, kwargs) => {
        const limit = parsePositiveInt(kwargs?.limit, 30, '--limit');
        const turns = requireArrayResult(await evaluateQoder(page, QODER_TURNS_JS), 'qoder read');
        if (!turns.length) {
            throw new EmptyResultError('qoder read', 'No chat turns detected. Open a quest first.');
        }
        return turns.slice(0, limit).map((t, i) => ({
            Index: i + 1,
            Role: t.role,
            Text: (t.text || '').slice(0, 1200),
        }));
    },
});
