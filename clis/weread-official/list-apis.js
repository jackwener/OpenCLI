import { cli, Strategy } from '@jackwener/opencli/registry';
import { callGateway, emptyResult, SKILL_VERSION } from './utils.js';

/**
 * `/_list` is the gateway's meta-endpoint. The response shape is not strongly
 * specified in SKILL.md beyond "returns all available api_name + their param
 * definitions", so we surface every visible field with light normalization
 * (api_name + description/help + required/optional params, falling back to a
 * raw-JSON column when the gateway changes shape).
 *
 * `clientSkillVersion` row is appended so debug output makes the local
 * SKILL_VERSION explicit — useful when triaging upgrade_info mismatches.
 */
cli({
    site: 'weread-official',
    name: 'list-apis',
    access: 'read',
    description: 'List every api_name supported by the WeRead agent gateway',
    domain: 'weread.qq.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [],
    columns: ['rank', 'apiName', 'description', 'required', 'optional', 'extras'],
    func: async () => {
        const payload = await callGateway('/_list', {});
        const apis = extractApiList(payload);
        if (apis.length === 0) {
            emptyResult('list-apis', 'Gateway returned no api inventory.');
        }
        const rows = apis.map((entry, i) => {
            const required = formatParamList(entry?.required ?? entry?.requiredParams ?? entry?.params?.required);
            const optional = formatParamList(entry?.optional ?? entry?.optionalParams ?? entry?.params?.optional);
            const description = String(entry?.description ?? entry?.help ?? entry?.summary ?? '');
            const extras = summarizeExtras(entry, ['api_name', 'apiName', 'name', 'description', 'help', 'summary', 'required', 'optional', 'requiredParams', 'optionalParams', 'params']);
            return {
                rank: i + 1,
                apiName: String(entry?.api_name ?? entry?.apiName ?? entry?.name ?? ''),
                description,
                required,
                optional,
                extras,
            };
        });
        rows.push({
            rank: rows.length + 1,
            apiName: '(client)',
            description: 'Local skill version reported with every gateway request',
            required: '',
            optional: '',
            extras: `SKILL_VERSION=${SKILL_VERSION}`,
        });
        return rows;
    },
});

function extractApiList(payload) {
    if (!payload || typeof payload !== 'object') return [];
    const candidates = [payload?.apis, payload?.list, payload?.data, payload?.items, payload?.endpoints];
    for (const candidate of candidates) {
        if (Array.isArray(candidate) && candidate.length > 0) return candidate;
    }
    if (Array.isArray(payload)) return payload;
    return [];
}

function formatParamList(value) {
    if (!value) return '';
    if (Array.isArray(value)) {
        return value
            .map((entry) => (typeof entry === 'string' ? entry : entry?.name ?? entry?.param ?? ''))
            .filter(Boolean)
            .join(', ');
    }
    if (typeof value === 'object') {
        return Object.keys(value).filter(Boolean).join(', ');
    }
    return String(value);
}

function summarizeExtras(entry, knownKeys) {
    if (!entry || typeof entry !== 'object') return '';
    const known = new Set(knownKeys);
    const rest = {};
    for (const [key, value] of Object.entries(entry)) {
        if (known.has(key)) continue;
        rest[key] = value;
    }
    if (Object.keys(rest).length === 0) return '';
    try {
        return JSON.stringify(rest);
    }
    catch {
        return '';
    }
}
