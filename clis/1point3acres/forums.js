/**
 * 一亩三分地 所有版块清单 — parsed from /bbs/forum.php
 *
 * Each forum card has:
 *   <a href="forum-<fid>-1.html" ... class="... overflow-hidden whitespace-nowrap hidden desktop:block">版块名</a>
 * and an adjacent description element. We dedupe by fid and return name + url.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { fetchHtml, decodeEntities, BASE } from './utils.js';

cli({
    site: '1point3acres',
    name: 'forums',
    access: 'read',
    description: '一亩三分地 所有版块（fid + 版块名）',
    domain: 'www.1point3acres.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'filter', type: 'string', default: '', help: '按版块名关键字过滤（子串匹配，中英文）' },
    ],
    columns: ['fid', 'name', 'url'],
    func: async (args) => {
        const html = await fetchHtml(`${BASE}/forum.php`);
        const seen = new Map();
        const re = /<a href="forum-(\d+)-1\.html"[^>]*class="[^"]*overflow-hidden[^"]*"[^>]*>\s*([^<]+?)\s*<\/a>/g;
        let m;
        while ((m = re.exec(html))) {
            const fid = m[1];
            let name = decodeEntities(m[2].trim());
            // Some subforum labels are wrapped in brackets — unwrap for display parity.
            name = name.replace(/^\[(.+)\]$/, '$1').trim();
            if (!name || seen.has(fid)) continue;
            seen.set(fid, name);
        }
        const filter = String(args.filter || '').toLowerCase().trim();
        const out = [];
        for (const [fid, name] of seen) {
            if (filter && !name.toLowerCase().includes(filter)) continue;
            out.push({ fid, name, url: `${BASE}/forum-${fid}-1.html` });
        }
        return out;
    },
});
