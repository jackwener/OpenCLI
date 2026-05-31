// Browser-side state on kimi.com (analog to Grok's storage commands).
//
//   storage-keys [--storage local|session] [--filter]
//   storage-get <key> [--storage] [--max-bytes]
//   cookies         — list JS-visible cookies
//   idb-list        — list IndexedDB databases on kimi.com

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    ArgumentError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';
import { KIMI_DOMAIN, ensureOnKimi } from './_utils.js';

const STORAGE_COLUMNS = ['Field', 'Value', 'Index', 'Key', 'Bytes', 'Name', 'Preview', 'Database', 'Version'];

function pickStore(args) {
    const s = String(args?.storage || 'local').trim().toLowerCase();
    if (s !== 'local' && s !== 'session') {
        throw new ArgumentError('storage', 'must be "local" or "session"');
    }
    return s === 'session' ? 'sessionStorage' : 'localStorage';
}

// -------- storage-keys --------
cli({
    site: 'kimi',
    name: 'storage-keys',
    access: 'read',
    description: 'List localStorage / sessionStorage keys on kimi.com (with byte sizes).',
    domain: KIMI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'storage', required: false, default: 'local', help: '"local" or "session"' },
        { name: 'filter', required: false, help: 'Case-insensitive substring filter over keys' },
        { name: 'limit', type: 'int', required: false, default: 100 },
    ],
    columns: STORAGE_COLUMNS,
    func: async (page, kwargs) => {
        await ensureOnKimi(page);
        const store = pickStore(kwargs);
        const raw = await page.evaluate(`(() => {
      const s = ${store};
      const out = [];
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        const v = s.getItem(k) || '';
        out.push({ k, bytes: v.length });
      }
      return out;
    })()`);
        const flt = kwargs?.filter ? String(kwargs.filter).toLowerCase() : null;
        const filtered = flt ? raw.filter((r) => r.k.toLowerCase().includes(flt)) : raw;
        if (!filtered.length) {
            throw new EmptyResultError('kimi storage-keys', flt ? `No keys match "${flt}".` : `${store} is empty.`);
        }
        filtered.sort((a, b) => a.k.localeCompare(b.k));
        const limit = Number.isInteger(kwargs?.limit) && kwargs.limit > 0 ? kwargs.limit : 100;
        return filtered.slice(0, limit).map((r, i) => ({ Index: i + 1, Key: r.k, Bytes: r.bytes }));
    },
});

// -------- storage-get --------
cli({
    site: 'kimi',
    name: 'storage-get',
    access: 'read',
    description: 'Read a single localStorage / sessionStorage value on kimi.com. Auto-decodes JSON.',
    domain: KIMI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'key', positional: true, required: true, help: 'Storage key' },
        { name: 'storage', required: false, default: 'local' },
        { name: 'max-bytes', type: 'int', required: false, default: 4000 },
    ],
    columns: STORAGE_COLUMNS,
    func: async (page, kwargs) => {
        const key = String(kwargs?.key || '').trim();
        if (!key) throw new ArgumentError('key', 'is required');
        await ensureOnKimi(page);
        const store = pickStore(kwargs);
        const raw = await page.evaluate(`${store}.getItem(${JSON.stringify(key)})`);
        if (raw === null || raw === undefined) {
            throw new CommandExecutionError(`Key not found in ${store}: ${key}`, '');
        }
        const max = Number.isInteger(kwargs['max-bytes']) && kwargs['max-bytes'] > 0 ? kwargs['max-bytes'] : 4000;
        let parsed = raw;
        let kind = 'string';
        try {
            parsed = JSON.parse(raw);
            kind = Array.isArray(parsed) ? 'array' : typeof parsed;
        } catch {}
        const text = kind === 'string' ? parsed : JSON.stringify(parsed, null, 2);
        const truncated = text.length > max;
        return [
            { Field: 'Key', Value: key },
            { Field: 'Store', Value: store },
            { Field: 'Type', Value: kind },
            { Field: 'Size', Value: `${text.length} chars${truncated ? ' (truncated)' : ''}` },
            { Field: 'Value', Value: truncated ? text.slice(0, max) + '\n...(truncated)' : text },
        ];
    },
});

// -------- cookies --------
cli({
    site: 'kimi',
    name: 'cookies',
    access: 'read',
    description: 'List kimi.com cookies visible to JavaScript (httpOnly cookies are deliberately not shown).',
    domain: KIMI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [],
    columns: STORAGE_COLUMNS,
    func: async (page) => {
        await ensureOnKimi(page);
        const raw = await page.evaluate('document.cookie');
        if (!raw) {
            throw new EmptyResultError('kimi cookies', 'document.cookie is empty (likely all cookies are httpOnly).');
        }
        const cookies = raw.split('; ').map((pair) => {
            const idx = pair.indexOf('=');
            if (idx < 0) return { name: pair, value: '' };
            return { name: pair.slice(0, idx), value: pair.slice(idx + 1) };
        });
        return cookies.map((c, i) => ({
            Index: i + 1,
            Name: c.name,
            Bytes: c.value.length,
            Preview: c.value.slice(0, 40) + (c.value.length > 40 ? '…' : ''),
        }));
    },
});

// -------- idb-list --------
cli({
    site: 'kimi',
    name: 'idb-list',
    access: 'read',
    description: 'List IndexedDB databases on kimi.com.',
    domain: KIMI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [],
    columns: STORAGE_COLUMNS,
    func: async (page) => {
        await ensureOnKimi(page);
        const dbs = await page.evaluate(`(async () => {
      if (!indexedDB.databases) return [];
      return await indexedDB.databases();
    })()`);
        if (!Array.isArray(dbs) || !dbs.length) {
            throw new EmptyResultError('kimi idb-list', 'No IndexedDB databases.');
        }
        return dbs.map((d, i) => ({ Index: i + 1, Database: d.name || '(unnamed)', Version: String(d.version || '') }));
    },
});
