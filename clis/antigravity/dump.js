import { cli, Strategy } from '@jackwener/opencli/registry';
import * as fs from 'node:fs';
export const dumpCommand = cli({
    site: 'antigravity',
    name: 'dump',
    access: 'read',
    description: 'Dump the DOM to help AI understand the UI',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['htmlFile', 'snapFile'],
    func: async (page) => {
        // Extract HTML
        const html = await page.evaluate('document.body.innerHTML');
        fs.writeFileSync('/tmp/antigravity-dom.html', html);
        // Extract Snapshot
        let snapFile = '';
        try {
            const snap = await page.snapshot({ raw: true });
            snapFile = '/tmp/antigravity-snapshot.json';
            fs.writeFileSync(snapFile, JSON.stringify(snap, null, 2));
        }
        catch (e) {
            snapFile = 'Failed';
        }
        return [{ htmlFile: '/tmp/antigravity-dom.html', snapFile }];
    },
});
