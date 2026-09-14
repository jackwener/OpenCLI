// opencli typora read — read the source Markdown of the current Typora document.

import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import * as fs from 'node:fs';
import { ensureTyporaInstalled, getFrontDocumentPath, runJxa } from './_utils.js';

cli({
    site: 'typora',
    name: 'read',
    access: 'read',
    description: 'Read the Markdown source of the current Typora document.',
    domain: 'typora.io',
    strategy: Strategy.LOCAL,
    browser: false,
    args: [
        { name: 'as', type: 'string', default: 'markdown', help: 'markdown | html | plain (html/plain require Accessibility permission)' },
    ],
    columns: ['status', 'file', 'content', 'format'],
    func: async (args) => {
        ensureTyporaInstalled();
        const format = String(args.as || 'markdown').toLowerCase();
        const docPath = getFrontDocumentPath();
        if (!docPath || !fs.existsSync(docPath)) {
            throw new EmptyResultError('typora read', 'No Typora document is currently open, or it has not been saved');
        }

        if (format === 'markdown' || format === 'md') {
            const content = fs.readFileSync(docPath, 'utf-8');
            return [{ status: 'read', file: docPath, content, format: 'markdown' }];
        }

        const menuLabels = {
            html: '复制为 HTML 代码',
            plain: '复制为纯文本',
        };
        const menuLabel = menuLabels[format];
        if (!menuLabel) {
            throw new ArgumentError(`unsupported read format: ${format}`);
        }

        try {
            const result = runJxa(`
                (function() {
                    var se = Application("System Events");
                    se.includeStandardAdditions = true;
                    var proc = se.processes.byName("Typora");
                    proc.menuBars[0].menuBarItems.byName("编辑").menus[0].menuItems.byName(${JSON.stringify(menuLabel)}).click();
                    delay(0.5);
                    var content = se.theClipboard();
                    se.setTheClipboardTo("");
                    return JSON.stringify({ content: content });
                })();
            `);
            const { content } = JSON.parse(result);
            return [{ status: 'read', file: docPath, content, format }];
        } catch (err) {
            throw new CommandExecutionError(String(err.message || err), 'Copy-via-menu failed. Check System Events Accessibility permission in System Settings.');
        }
    },
});
