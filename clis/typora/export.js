// opencli typora export — trigger File → Export for the current document.
//
// Requires Accessibility permission for System Events to click menus and fill
// the save panel. Without it, the export menu is triggered but the user must
// confirm the dialog manually.

import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import * as path from 'node:path';
import { ensureTyporaInstalled, getFrontDocumentPath, runJxa } from './_utils.js';

const FORMAT_LABELS = {
    pdf: 'PDF',
    html: 'HTML',
    image: '图像',
    docx: 'Word (.docx)',
    openoffice: 'OpenOffice',
    rtf: 'RTF',
    epub: 'Epub',
    latex: 'LaTeX',
    wiki: 'Media Wiki',
    rst: 'reStructuredText',
    textile: 'Textile',
    opml: 'OPML',
};

cli({
    site: 'typora',
    name: 'export',
    access: 'write',
    description: 'Trigger File → Export for the current document. Requires Accessibility permission for System Events.',
    domain: 'typora.io',
    strategy: Strategy.LOCAL,
    browser: false,
    args: [
        { name: 'to', type: 'string', default: 'pdf', help: 'pdf | html | image | docx | openoffice | rtf | epub | latex | wiki | rst | textile | opml' },
        { name: 'output', type: 'string', required: false, help: 'Desired output path (best-effort; export dialog may still appear without Accessibility permission)' },
    ],
    columns: ['status', 'file', 'format', 'output', 'note'],
    func: async (args) => {
        ensureTyporaInstalled();
        const format = String(args.to || 'pdf').toLowerCase();
        const outputArg = args.output ? path.resolve(String(args.output)) : '';

        const sourcePath = getFrontDocumentPath();
        if (!sourcePath) {
            throw new EmptyResultError('typora export', 'No Typora document is currently open');
        }

        const menuLabel = FORMAT_LABELS[format];
        if (!menuLabel) {
            throw new ArgumentError(`unsupported export format: ${format}`);
        }

        const outputPath = outputArg || path.join(
            path.dirname(sourcePath),
            `${path.basename(sourcePath, path.extname(sourcePath))}.${format === 'image' ? 'png' : format}`
        );

        try {
            runJxa(`
                (function() {
                    var se = Application("System Events");
                    se.includeStandardAdditions = true;
                    var proc = se.processes.byName("Typora");
                    proc.menuBars[0].menuBarItems.byName("文件").menus[0]
                        .menuItems.byName("导出").menus[0]
                        .menuItems.byName(${JSON.stringify(menuLabel)}).click();
                })();
            `);
        } catch (err) {
            throw new CommandExecutionError(String(err.message || err), 'Menu click failed. Check System Events Accessibility permission in System Settings.');
        }

        // Best-effort: if the save panel appears, fill it in and confirm.
        try {
            runJxa(`
                (function() {
                    var app = Application("Typora");
                    app.activate();
                    delay(0.8);
                    var sheet = app.windows[0].sheets[0];
                    var textField = sheet.textFields[0];
                    textField.value.set("");
                    textField.value.set(${JSON.stringify(outputPath)});
                    delay(0.2);
                    sheet.buttons.byName("存储").click();
                })();
            `);
        } catch {
            // Without Accessibility permission the panel may not exist or may not be controllable.
        }

        return [{
            status: 'export-triggered',
            file: sourcePath,
            format,
            output: outputPath,
            note: 'Export dialog may require manual confirmation if Accessibility permission is not granted.',
        }];
    },
});
