import * as fs from 'node:fs';
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    ArgumentError,
    CommandExecutionError,
} from '@jackwener/opencli/errors';
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

// -------- user-rules-set --------
cli({
    site: 'trae-solo',
    name: 'user-rules-set',
    access: 'write',
    description: 'Overwrite ~/.trae/user_rules.md from a local file path. Trae picks up changes on next chat start.',
    domain: 'localhost',
    browser: false,
    strategy: Strategy.LOCAL,
    args: [
        { name: 'source', positional: true, required: true, help: 'Path to the markdown file whose content becomes the new user rules' },
        { name: 'yes', type: 'boolean', default: false, help: 'Actually write (default is dry-run)' },
    ],
    columns: ['Status', 'Path', 'Action'],
    func: async (args) => {
        const source = String(args.source || '').trim();
        if (!source) throw new ArgumentError('source required');
        if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
            throw new CommandExecutionError(`Source file not found: ${source}`, '');
        }
        const yes = args.yes === true || args.yes === 'true' || args.yes === '1';
        const newContent = fs.readFileSync(source, 'utf-8');

        if (!yes) {
            return [{
                Status: 'dry-run (pass --yes to overwrite)',
                Path: TRAE_USER_RULES,
                Action: `would write ${newContent.length} bytes`,
            }];
        }
        const tmp = TRAE_USER_RULES + '.tmp-' + process.pid;
        fs.writeFileSync(tmp, newContent);
        fs.renameSync(tmp, TRAE_USER_RULES);
        return [{
            Status: 'written',
            Path: TRAE_USER_RULES,
            Action: `wrote ${newContent.length} bytes`,
        }];
    },
});
