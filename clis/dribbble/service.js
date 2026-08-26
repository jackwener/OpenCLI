import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    DRIBBBLE_HOST,
    DRIBBBLE_ORIGIN,
    extractServiceRows,
    normalizeLimit,
    optionalQuery,
    requireDesigner,
    requireRows,
} from './utils.js';

cli({
    site: 'dribbble',
    name: 'service',
    description: 'List services offered by a Dribbble designer',
    domain: DRIBBBLE_HOST,
    strategy: Strategy.PUBLIC,
    access: 'read',
    browser: true,
    args: [
        { name: 'designer', positional: true, required: true, help: 'Dribbble username or profile slug (for example: halolab)' },
        { name: 'query', type: 'string', default: '', help: 'Optional service title filter' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of services (max 30)' },
    ],
    columns: ['rank', 'id', 'title', 'priceText', 'duration', 'description', 'quickHire', 'url', 'imageUrl', 'designer'],
    func: async (page, args) => {
        const designer = requireDesigner(args.designer);
        const query = optionalQuery(args.query);
        const limit = normalizeLimit(args.limit, 20, 30);
        const url = `${DRIBBBLE_ORIGIN}/${encodeURIComponent(designer)}/services`;
        try {
            await page.goto(url);
            await page.wait(2);
            const payload = await page.evaluate(extractServiceRows, designer, limit);
            let rows = requireRows(payload, 'dribbble service');
            if (query) {
                const needle = query.toLowerCase();
                rows = rows.filter((row) => `${row.title} ${row.description ?? ''}`.toLowerCase().includes(needle));
                if (rows.length === 0) {
                    throw new EmptyResultError('dribbble service', `No services matching "${query}" for designer "${designer}"`);
                }
            }
            return rows.slice(0, limit).map((row, index) => ({ ...row, rank: index + 1 }));
        } catch (error) {
            if (error?.code === 'EMPTY_RESULT' || error?.code === 'COMMAND_EXEC' || error?.code === 'ARGUMENT') throw error;
            throw new CommandExecutionError(`Dribbble service extraction failed: ${error?.message ?? error}`);
        }
    },
});
