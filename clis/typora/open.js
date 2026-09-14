// opencli typora open — open a Markdown file in Typora.

import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ensureTyporaInstalled, openInTypora } from './_utils.js';

cli({
    site: 'typora',
    name: 'open',
    access: 'write',
    description: 'Open a Markdown file in Typora.',
    domain: 'typora.io',
    strategy: Strategy.LOCAL,
    browser: false,
    args: [
        { name: 'file', type: 'string', required: true, positional: true, help: 'Path to the Markdown file' },
    ],
    columns: ['status', 'file'],
    func: async (args) => {
        ensureTyporaInstalled();
        const filePath = path.resolve(String(args.file || ''));
        if (!fs.existsSync(filePath)) {
            throw new ArgumentError(`file not found: ${filePath}`);
        }
        try {
            openInTypora(filePath);
        } catch (err) {
            throw new CommandExecutionError(String(err.message || err), '');
        }
        return [{ status: 'opened', file: filePath }];
    },
});
