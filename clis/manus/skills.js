import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { MANUS_DOMAIN, ensureOnManus, MANUS_API_CALL_JS, requireArray, requireObject, requireString } from './_utils.js';

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

        const data = requireObject(await page.evaluate(`(async () => {
            ${MANUS_API_CALL_JS}
            return callManusAPI('skill.v1.SkillService/ListSkills', {});
        })()`), 'skills');

        const rows = [];

        const hasUserSkills = Object.prototype.hasOwnProperty.call(data, 'userAddedSkills');
        const hasSystemSkills = Object.prototype.hasOwnProperty.call(data, 'systemSkills') || Object.prototype.hasOwnProperty.call(data, 'skills');
        if (!hasUserSkills && !hasSystemSkills) {
            throw new CommandExecutionError('Manus skills returned a malformed API payload');
        }

        const userSkills = hasUserSkills ? requireArray(data.userAddedSkills, 'user skills') : [];
        for (const [index, s] of userSkills.entries()) {
            rows.push({
                ID: requireString(s?.id || s?.uid, `user skill ${index + 1}`),
                Name: requireString(s?.name, `user skill ${index + 1}`),
                Description: (s.description || '—').slice(0, 80),
                Source: 'user',
            });
        }

        const systemSkills = Object.prototype.hasOwnProperty.call(data, 'systemSkills')
            ? requireArray(data.systemSkills, 'system skills')
            : (Object.prototype.hasOwnProperty.call(data, 'skills') ? requireArray(data.skills, 'system skills') : []);
        for (const [index, s] of systemSkills.entries()) {
            rows.push({
                ID: requireString(s?.id || s?.uid, `system skill ${index + 1}`),
                Name: requireString(s?.name, `system skill ${index + 1}`),
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
