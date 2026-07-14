// opencli typora write — write Markdown content to a file and open it in Typora.

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ensureTyporaInstalled, openInTypora } from './_utils.js';

cli({
    site: 'typora',
    name: 'write',
    access: 'write',
    description: 'Write Markdown content to a file and open it in Typora.',
    domain: 'typora.io',
    strategy: Strategy.LOCAL,
    browser: false,
    args: [
        { name: 'file', type: 'string', required: true, positional: true, help: 'Path to the Markdown file' },
        { name: 'content', type: 'string', required: false, positional: true, help: 'Markdown content to write (omit to just open the file)' },
    ],
    columns: ['status', 'file'],
    func: async (args) => {
        ensureTyporaInstalled();
        const filePath = path.resolve(String(args.file || ''));
        const content = String(args.content ?? '');
        fs.writeFileSync(filePath, content, 'utf-8');
        try {
            openInTypora(filePath);
        } catch (err) {
            throw new CommandExecutionError(String(err.message || err), '');
        }
        return [{ status: 'written', file: filePath }];
    },
});
