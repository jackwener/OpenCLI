import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { MANUS_DOMAIN, ensureOnManus, MANUS_API_CALL_JS } from './_utils.js';

cli({
    site: 'manus',
    name: 'skills',
    access: 'read',
    description: 'List Manus skills (user-added and system).',
    domain: MANUS_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: true,
    args: [],
    columns: ['ID', 'Name', 'Description', 'Source'],
    func: async (page) => {
        await ensureOnManus(page);

        const data = await page.evaluate(`(async () => {
            ${MANUS_API_CALL_JS}
            return callManusAPI('skill.v1.SkillService/ListSkills', {});
        })()`);

        const rows = [];

        const userSkills = data?.userAddedSkills || [];
        for (const s of userSkills) {
            rows.push({
                ID: s.id || s.uid || '—',
                Name: s.name || '—',
                Description: (s.description || '—').slice(0, 80),
                Source: 'user',
            });
        }

        const systemSkills = data?.systemSkills || data?.skills || [];
        for (const s of systemSkills) {
            rows.push({
                ID: s.id || s.uid || '—',
                Name: s.name || '—',
                Description: (s.description || '—').slice(0, 80),
                Source: 'system',
            });
        }

        if (!rows.length) {
            throw new EmptyResultError('manus skills', 'No skills found.');
        }

        return rows;
    },
});