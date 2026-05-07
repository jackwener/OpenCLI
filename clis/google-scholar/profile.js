import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { clampInt, requireNonEmptyQuery } from '../_shared/common.js';

cli({
    site: 'google-scholar',
    name: 'profile',
    access: 'read',
    description: 'View a Google Scholar author profile',
    domain: 'scholar.google.com',
    strategy: Strategy.PUBLIC,
    browser: true,
    args: [
        { name: 'author', positional: true, required: true, help: 'Author name or Scholar user ID (e.g. JicYPdAAAAAJ)' },
        { name: 'limit', type: 'int', default: 10, help: 'Max papers to show (max 20)' },
    ],
    columns: ['rank', 'title', 'cited', 'year'],
    func: async (page, kwargs) => {
        const author = requireNonEmptyQuery(kwargs.author, 'author');
        const limit = clampInt(kwargs.limit, 10, 1, 20);

        const isUserId = /^[A-Za-z0-9_-]{12}$/.test(author);
        if (isUserId) {
            await page.goto(`https://scholar.google.com/citations?user=${author}&hl=en&sortby=citedby`);
        } else {
            await page.goto(`https://scholar.google.com/citations?view_op=search_authors&mauthors=${encodeURIComponent(author)}&hl=en`);
            await page.wait(3);

            const profileClicked = await page.evaluate(`(() => {
                var link = document.querySelector('.gs_ai_pho, .gsc_oai_photo, a[href*="citations?user="]');
                if (link) { link.click(); return true; }
                return false;
            })()`);

            if (!profileClicked) {
                throw new CommandExecutionError(`No profile found for: ${author}`);
            }
        }

        await page.wait(3);

        const data = await page.evaluate(`(() => {
            var name = (document.querySelector('#gsc_prf_in') || {}).textContent || '';
            var affiliation = (document.querySelector('.gsc_prf_il') || {}).textContent || '';

            var stats = document.querySelectorAll('#gsc_rsb_st td.gsc_rsb_std');
            var citations = stats[0] ? stats[0].textContent.trim() : '';
            var hIndex = stats[2] ? stats[2].textContent.trim() : '';
            var i10Index = stats[4] ? stats[4].textContent.trim() : '';

            var papers = [];
            var rows = document.querySelectorAll('#gsc_a_b .gsc_a_tr');
            for (var i = 0; i < rows.length && i < ${limit}; i++) {
                var titleEl = rows[i].querySelector('.gsc_a_at');
                var citedEl = rows[i].querySelector('.gsc_a_ac');
                var yearEl = rows[i].querySelector('.gsc_a_y span');
                if (titleEl) papers.push({
                    rank: i + 1,
                    title: titleEl.textContent.trim(),
                    cited: citedEl ? citedEl.textContent.trim() : '0',
                    year: yearEl ? yearEl.textContent.trim() : '',
                });
            }

            return {
                name: name.trim(),
                affiliation: affiliation.trim(),
                citations: citations,
                hIndex: hIndex,
                i10Index: i10Index,
                papers: papers,
            };
        })()`);

        if (!data?.name) {
            throw new CommandExecutionError(`Could not load Google Scholar profile for: ${author}`);
        }

        if (!data.papers || data.papers.length === 0) {
            throw new CommandExecutionError(`No papers found for: ${data.name || author}`);
        }

        const summary = {
            rank: 0,
            title: data.name + (data.affiliation ? ' (' + data.affiliation + ')' : ''),
            cited: 'h=' + data.hIndex + ' i10=' + data.i10Index + ' total=' + data.citations,
            year: '-',
        };

        return [summary, ...data.papers];
    },
});
