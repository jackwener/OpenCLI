// Renderer-side storage commands for Trae SOLO.
//
// These query the Electron renderer's localStorage / sessionStorage /
// cookies / IndexedDB via CDP (port 9235), NOT the on-disk state.vscdb.
// For the FS-side equivalents see state-fs.js (state-keys / state-get).
//
//   storage-keys [--storage local|session] [--filter] [--limit]
//   storage-get <key> [--storage] [--max-bytes]
//   cookies          — list JS-visible cookies on the renderer
//   idb-list         — list IndexedDB databases the renderer can see
//                       (Trae SOLO ships an @byted/ve-rtc DB for the
//                        Volcengine RTC voice/video infra)

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    ArgumentError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';

function pickStore(args) {
    const s = String(args?.storage || 'local').trim().toLowerCase();
    if (s !== 'local' && s !== 'session') {
        throw new ArgumentError('storage', 'must be "local" or "session"');
    }
    return s === 'session' ? 'sessionStorage' : 'localStorage';
}

// -------- storage-keys --------
cli({
    site: 'trae-solo',
    name: 'storage-keys',
    access: 'read',
    description: 'List localStorage / sessionStorage keys on the Trae SOLO renderer (CDP). For the on-disk VSCode state.vscdb, see state-keys.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'storage', required: false, default: 'local', help: '"local" or "session"' },
        { name: 'filter', required: false, help: 'Case-insensitive substring filter' },
        { name: 'limit', type: 'int', required: false, default: 100, help: 'Max rows to return' },
    ],
    columns: ['Index', 'Key', 'Bytes', 'Name', 'Preview', 'Database', 'Version'],
    func: async (page, kwargs) => {
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
            throw new EmptyResultError('trae-solo storage-keys', flt ? `No keys match "${flt}".` : `${store} is empty.`);
        }
        filtered.sort((a, b) => a.k.localeCompare(b.k));
        const limit = Number.isInteger(kwargs?.limit) && kwargs.limit > 0 ? kwargs.limit : 100;
        return filtered.slice(0, limit).map((r, i) => ({
            Index: i + 1,
            Key: r.k,
            Bytes: r.bytes,
            Name: '',
            Preview: '',
            Database: '',
            Version: '',
        }));
    },
});

// -------- storage-get --------
cli({
    site: 'trae-solo',
    name: 'storage-get',
    access: 'read',
    description: 'Read a single localStorage / sessionStorage value on the Trae SOLO renderer.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'key', positional: true, required: true, help: 'Storage key (use storage-keys to discover)' },
        { name: 'storage', required: false, default: 'local', help: '"local" or "session"' },
        { name: 'max-bytes', type: 'int', required: false, default: 4000, help: 'Truncate value to this many chars' },
    ],
    columns: ['Field', 'Value'],
    func: async (page, kwargs) => {
        const key = String(kwargs?.key || '').trim();
        if (!key) throw new ArgumentError('key', 'is required');
        const store = pickStore(kwargs);
        const raw = await page.evaluate(`${store}.getItem(${JSON.stringify(key)})`);
        if (raw === null) throw new CommandExecutionError(`Key not found in ${store}: ${key}`, '');
        const max = Number.isInteger(kwargs['max-bytes']) && kwargs['max-bytes'] > 0 ? kwargs['max-bytes'] : 4000;
        let parsed = raw, kind = 'string';
        try { parsed = JSON.parse(raw); kind = Array.isArray(parsed) ? 'array' : typeof parsed; } catch {}
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
    site: 'trae-solo',
    name: 'cookies',
    access: 'read',
    description: 'List cookies on the Trae SOLO renderer (JS-visible via document.cookie; httpOnly cookies not shown).',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Index', 'Key', 'Bytes', 'Name', 'Preview', 'Database', 'Version'],
    func: async (page) => {
        const raw = await page.evaluate('document.cookie');
        if (!raw) {
            throw new EmptyResultError('trae-solo cookies', 'document.cookie is empty (Trae uses Electron session cookies, mostly httpOnly).');
        }
        const cookies = raw.split('; ').map((pair) => {
            const idx = pair.indexOf('=');
            if (idx < 0) return { name: pair, value: '' };
            return { name: pair.slice(0, idx), value: pair.slice(idx + 1) };
        });
        return cookies.map((c, i) => ({
            Index: i + 1,
            Key: '',
            Name: c.name,
            Bytes: c.value.length,
            Preview: c.value.slice(0, 40) + (c.value.length > 40 ? '…' : ''),
            Database: '',
            Version: '',
        }));
    },
});

// -------- idb-list --------
cli({
    site: 'trae-solo',
    name: 'idb-list',
    access: 'read',
    description: 'List IndexedDB databases on the Trae SOLO renderer. Trae ships an @byted/ve-rtc DB used by the Volcengine RTC voice/video infrastructure.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Index', 'Key', 'Bytes', 'Name', 'Preview', 'Database', 'Version'],
    func: async (page) => {
        const dbs = await page.evaluate(`(async () => indexedDB.databases ? await indexedDB.databases() : [])()`);
        if (!Array.isArray(dbs) || !dbs.length) {
            throw new EmptyResultError('trae-solo idb-list', 'No IndexedDB databases.');
        }
        return dbs.map((d, i) => ({
            Index: i + 1,
            Key: '',
            Bytes: '',
            Name: '',
            Preview: '',
            Database: d.name || '(unnamed)',
            Version: String(d.version || ''),
        }));
    },
});
