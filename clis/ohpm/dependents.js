// ohpm dependents — list packages that depend on an OHPM package.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    OHPM_API,
    normalizeText,
    ohpmFetch,
    packageUrl,
    requireBoundedInt,
    requirePackageName,
} from './utils.js';

cli({
    site: 'ohpm',
    name: 'dependents',
    access: 'read',
    description: 'List packages that depend on an OHPM package',
    domain: 'ohpm.openharmony.cn',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'name', positional: true, required: true, help: 'OHPM package name (e.g. "@ohos/axios")' },
        { name: 'version', type: 'string', required: false, help: 'Package version; omit for latest' },
        { name: 'limit', type: 'int', default: 20, help: 'Max dependents (1-50)' },
    ],
    columns: ['rank', 'name', 'version', 'dependent', 'url'],
    func: async (args) => {
        const name = requirePackageName(args.name);
        const version = normalizeText(args.version);
        const limit = requireBoundedInt(args.limit, 20, 50);
        const path = version
            ? `${encodeURIComponent(name)}/${encodeURIComponent(version)}`
            : encodeURIComponent(name);
        const body = await ohpmFetch(`${OHPM_API}/v1/detail/${path}`, `ohpm dependents ${name}`);
        const item = body?.body;
        if (!item?.name) {
            throw new EmptyResultError('ohpm dependents', `OHPM returned no metadata for "${name}".`);
        }
        const rows = Array.isArray(item.dependent?.rows) ? item.dependent.rows : [];
        if (!rows.length) {
            throw new EmptyResultError('ohpm dependents', `OHPM returned no dependents for "${name}".`);
        }
        return rows.slice(0, limit).map((dependent, i) => ({
            rank: i + 1,
            name: normalizeText(item.name),
            version: normalizeText(item.version),
            dependent: normalizeText(dependent),
            url: packageUrl(item.name),
        }));
    },
});
