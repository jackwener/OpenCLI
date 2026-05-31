import * as fs from 'node:fs';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { TRAE_USER_RULES } from './_fs.js';

// -------- user-rules --------
cli({
    site: 'trae-solo',
    name: 'user-rules',
    access: 'read',
    description: 'Print Trae SOLO user rules (~/.trae/user_rules.md).',
    domain: 'localhost',
    browser: false,
    strategy: Strategy.LOCAL,
    args: [],
    columns: ['Field', 'Value'],
    func: async () => {
        if (!fs.existsSync(TRAE_USER_RULES)) {
            return [{ Field: 'path', Value: TRAE_USER_RULES }, { Field: 'content', Value: '(file does not exist yet)' }];
        }
        const content = fs.readFileSync(TRAE_USER_RULES, 'utf-8');
        const stat = fs.statSync(TRAE_USER_RULES);
        return [
            { Field: 'path', Value: TRAE_USER_RULES },
            { Field: 'size', Value: String(stat.size) + ' bytes' },
            { Field: 'modified', Value: stat.mtime.toISOString().replace('T', ' ').slice(0, 19) },
            { Field: 'content', Value: content },
        ];
    },
});
