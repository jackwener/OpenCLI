// nvd cve — fetch a single CVE from the NIST National Vulnerability Database.
//
// Hits the CVE API 2.0 (`services.nvd.nist.gov/rest/json/cves/2.0?cveId=…`).
// Returns the agent-useful projection: id, published / last-modified dates,
// vuln status, English description, CVSS v3.1 base score / severity / vector,
// CWE id(s), CISA KEV flag.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

const NVD_BASE = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
const UA = 'opencli-nvd-adapter (+https://github.com/jackwener/opencli)';
const CVE_ID = /^CVE-\d{4}-\d{4,}$/i;

function requireCveId(value) {
    const s = String(value ?? '').trim().toUpperCase();
    if (!s) throw new ArgumentError('nvd CVE id is required (e.g. "CVE-2021-44228")');
    if (!CVE_ID.test(s)) {
        throw new ArgumentError(
            `nvd CVE id "${value}" is not a valid CVE identifier`,
            'Expected the form "CVE-YYYY-N..." with at least 4 sequence digits.',
        );
    }
    return s;
}

function pickEnglishDescription(descriptions) {
    if (!Array.isArray(descriptions)) return '';
    const en = descriptions.find((d) => d?.lang === 'en');
    return String(en?.value ?? descriptions[0]?.value ?? '').trim();
}

function pickPrimaryCvss(metrics) {
    if (!metrics || typeof metrics !== 'object') return null;
    const candidates = [
        ...(Array.isArray(metrics.cvssMetricV31) ? metrics.cvssMetricV31 : []),
        ...(Array.isArray(metrics.cvssMetricV30) ? metrics.cvssMetricV30 : []),
        ...(Array.isArray(metrics.cvssMetricV2) ? metrics.cvssMetricV2 : []),
    ];
    return candidates.find((m) => m?.type === 'Primary') || candidates[0] || null;
}

function joinCwes(weaknesses) {
    if (!Array.isArray(weaknesses)) return '';
    const ids = new Set();
    for (const w of weaknesses) {
        for (const desc of w?.description ?? []) {
            if (desc?.value) ids.add(String(desc.value));
        }
    }
    return [...ids].join(', ');
}

cli({
    site: 'nvd',
    name: 'cve',
    access: 'read',
    description: 'NIST NVD CVE detail (description, CVSS, CWE, KEV flag)',
    domain: 'services.nvd.nist.gov',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'CVE identifier (e.g. "CVE-2021-44228")' },
    ],
    columns: [
        'id', 'published', 'lastModified', 'vulnStatus', 'baseScore', 'severity',
        'attackVector', 'cwe', 'kevAdded', 'description', 'url',
    ],
    func: async (args) => {
        const id = requireCveId(args.id);
        const url = `${NVD_BASE}?cveId=${encodeURIComponent(id)}`;
        let resp;
        try {
            resp = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
        }
        catch (err) {
            throw new CommandExecutionError(`nvd cve request failed: ${err?.message ?? err}`);
        }
        if (resp.status === 403) {
            throw new CommandExecutionError(
                'nvd cve returned HTTP 403',
                'NVD enforces aggressive rate limits without an API key. Wait, then retry or set NVD_API_KEY (not yet wired).',
            );
        }
        if (resp.status === 429) {
            throw new CommandExecutionError(
                'nvd cve returned HTTP 429 (rate limited)',
                'NVD throttles unauthenticated traffic; wait several seconds before retry.',
            );
        }
        if (!resp.ok) {
            throw new CommandExecutionError(`nvd cve returned HTTP ${resp.status}`);
        }
        let body;
        try {
            body = await resp.json();
        }
        catch (err) {
            throw new CommandExecutionError(`nvd cve returned malformed JSON: ${err?.message ?? err}`);
        }
        const list = Array.isArray(body?.vulnerabilities) ? body.vulnerabilities : [];
        const cve = list[0]?.cve;
        if (!cve || !cve.id) {
            throw new EmptyResultError('nvd cve', `NVD has no record for "${id}".`);
        }
        const cvss = pickPrimaryCvss(cve.metrics);
        const cvssData = cvss?.cvssData ?? {};
        return [{
            id: String(cve.id),
            published: String(cve.published ?? '').slice(0, 10),
            lastModified: String(cve.lastModified ?? '').slice(0, 10),
            vulnStatus: String(cve.vulnStatus ?? ''),
            baseScore: cvssData.baseScore != null ? Number(cvssData.baseScore) : null,
            severity: String(cvssData.baseSeverity ?? cvss?.baseSeverity ?? ''),
            attackVector: String(cvssData.attackVector ?? ''),
            cwe: joinCwes(cve.weaknesses),
            kevAdded: cve.cisaExploitAdd ? String(cve.cisaExploitAdd).slice(0, 10) : '',
            description: pickEnglishDescription(cve.descriptions),
            url: `https://nvd.nist.gov/vuln/detail/${cve.id}`,
        }];
    },
});
