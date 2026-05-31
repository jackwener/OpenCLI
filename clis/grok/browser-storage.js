// Browser-side state on grok.com.
//
//   storage-keys [--storage local|session] [--filter]
//                — list keys in localStorage (default) or sessionStorage
//   storage-get <key> [--storage] [--max-bytes]
//                — read a single LS/SS value (auto-decodes JSON)
//   user-settings
//                — pretty-print the 'user-settings' localStorage object
//                  (privacy toggles + chat preferences + agent library)
//   cookies      — list grok.com cookies visible to JS via document.cookie
//                  (httpOnly auth cookies are deliberately invisible — that's
//                  a security feature, not a bug)
//   idb-list     — list IndexedDB databases on grok.com
//
// All commands are READ-ONLY. Mutating Grok's localStorage from outside the
// app would race with React state and likely break the UI.

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    ArgumentError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';
import {
    GROK_DOMAIN,
    ensureOnGrok,
} from './utils.js';

function pickStore(args) {
    const s = String(args?.storage || 'local').trim().toLowerCase();
    if (s !== 'local' && s !== 'session') {
        throw new ArgumentError('storage', 'must be "local" or "session"');
    }
    return s === 'session' ? 'sessionStorage' : 'localStorage';
}

// -------- storage-keys --------
cli({
    site: 'grok',
    name: 'storage-keys',
    access: 'read',
    description: 'List localStorage (default) or sessionStorage keys on grok.com, with byte sizes. Pass --storage session for sessionStorage.',
    domain: GROK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'storage', required: false, default: 'local', help: 'Storage type: "local" or "session"' },
        { name: 'filter', required: false, help: 'Case-insensitive substring filter over keys' },
        { name: 'limit', type: 'int', required: false, default: 100 },
    ],
    columns: ['Index', 'Key', 'Bytes'],
    func: async (page, kwargs) => {
        await ensureOnGrok(page);
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
            throw new EmptyResultError('grok storage-keys', flt ? `No keys match "${flt}".` : `${store} is empty.`);
        }
        filtered.sort((a, b) => a.k.localeCompare(b.k));
        const limit = Number.isInteger(kwargs.limit) && kwargs.limit > 0 ? kwargs.limit : 100;
        return filtered.slice(0, limit).map((r, i) => ({
            Index: i + 1,
            Key: r.k,
            Bytes: r.bytes,
        }));
    },
});

// -------- storage-get --------
cli({
    site: 'grok',
    name: 'storage-get',
    access: 'read',
    description: 'Read a single localStorage (default) or sessionStorage value on grok.com. Auto-decodes JSON; pass --max-bytes to truncate.',
    domain: GROK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'key', positional: true, required: true, help: 'Storage key (use storage-keys to discover)' },
        { name: 'storage', required: false, default: 'local', help: '"local" or "session"' },
        { name: 'max-bytes', type: 'int', required: false, default: 4000 },
    ],
    columns: ['Field', 'Value'],
    func: async (page, kwargs) => {
        const key = String(kwargs?.key || '').trim();
        if (!key) throw new ArgumentError('key', 'is required');
        await ensureOnGrok(page);
        const store = pickStore(kwargs);
        const raw = await page.evaluate(`${store}.getItem(${JSON.stringify(key)})`);
        if (raw === null || raw === undefined) {
            throw new CommandExecutionError(`Key not found in ${store}: ${key}`, 'Use storage-keys to discover available keys.');
        }
        const max = Number.isInteger(kwargs['max-bytes']) && kwargs['max-bytes'] > 0 ? kwargs['max-bytes'] : 4000;
        let parsed = raw;
        let kind = 'string';
        try {
            parsed = JSON.parse(raw);
            kind = Array.isArray(parsed) ? 'array' : typeof parsed;
        } catch {
            // not JSON, leave as string
        }
        const text = kind === 'string' ? parsed : JSON.stringify(parsed, null, 2);
        const truncated = text.length > max;
        return [
            { Field: 'Key', Value: key },
            { Field: 'Store', Value: store },
            { Field: 'Type', Value: kind },
            { Field: 'Size', Value: `${text.length} chars${truncated ? ' (truncated)' : ''}` },
            { Field: 'Value', Value: truncated ? text.slice(0, max) + '\n...(truncated, use --max-bytes to read more)' : text },
        ];
    },
});

// -------- user-settings --------
cli({
    site: 'grok',
    name: 'user-settings',
    access: 'read',
    description: 'Read Grok\'s "user-settings" localStorage object: privacy toggles (allowAutoShare, excludeFromTraining, enableMemory), chat preferences (hideThinkingTrace, requireCmdEnterToSubmit, isAsyncChat, ...), and the agent library / customizations.',
    domain: GROK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [],
    columns: ['Section', 'Field', 'Value'],
    func: async (page) => {
        await ensureOnGrok(page);
        const raw = await page.evaluate(`localStorage.getItem('user-settings')`);
        if (!raw) {
            throw new EmptyResultError('grok user-settings', 'user-settings key not present in localStorage.');
        }
        let obj;
        try {
            obj = JSON.parse(raw);
        } catch (e) {
            throw new CommandExecutionError(`user-settings is not valid JSON: ${e.message}`, '');
        }
        const rows = [];
        const prefs = obj.preferences || {};
        const topLevel = Object.keys(obj).filter((k) => k !== 'preferences' && !Array.isArray(obj[k]));
        for (const k of topLevel) {
            const v = obj[k];
            rows.push({ Section: 'general', Field: k, Value: String(v) });
        }
        for (const [k, v] of Object.entries(prefs)) {
            rows.push({ Section: 'preferences', Field: k, Value: String(v) });
        }
        for (const arrKey of ['agentLibrary', 'agentCustomizations']) {
            if (Array.isArray(obj[arrKey])) {
                rows.push({ Section: arrKey, Field: 'count', Value: String(obj[arrKey].length) });
                obj[arrKey].slice(0, 5).forEach((it, i) => {
                    const label = it?.name || it?.id || JSON.stringify(it).slice(0, 80);
                    rows.push({ Section: arrKey, Field: `[${i}]`, Value: label });
                });
            }
        }
        return rows;
    },
});

// -------- cookies --------
cli({
    site: 'grok',
    name: 'cookies',
    access: 'read',
    description: 'List grok.com cookies visible to JavaScript (via document.cookie). NOTE: httpOnly auth cookies (e.g. session tokens) are deliberately not visible — that\'s a security feature, not a bug.',
    domain: GROK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [],
    columns: ['Index', 'Name', 'Bytes', 'Preview'],
    func: async (page) => {
        await ensureOnGrok(page);
        const raw = await page.evaluate('document.cookie');
        if (!raw) {
            throw new EmptyResultError('grok cookies', 'document.cookie is empty (all cookies may be httpOnly).');
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
            // Show only the first 40 chars — never dump a full cookie value to
            // avoid accidentally leaking session tokens into logs.
            Preview: c.value.slice(0, 40) + (c.value.length > 40 ? '…' : ''),
        }));
    },
});

// -------- idb-list --------
cli({
    site: 'grok',
    name: 'idb-list',
    access: 'read',
    description: 'List IndexedDB databases visible on grok.com (via indexedDB.databases()). Does NOT read store contents — those may include third-party extension data and aren\'t Grok-managed.',
    domain: GROK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [],
    columns: ['Index', 'Database', 'Version'],
    func: async (page) => {
        await ensureOnGrok(page);
        const dbs = await page.evaluate(`(async () => {
      if (!indexedDB.databases) return [];
      return await indexedDB.databases();
    })()`);
        if (!Array.isArray(dbs) || !dbs.length) {
            throw new EmptyResultError('grok idb-list', 'No IndexedDB databases (or browser does not support indexedDB.databases()).');
        }
        return dbs.map((d, i) => ({
            Index: i + 1,
            Database: d.name || '(unnamed)',
            Version: String(d.version || ''),
        }));
    },
});
