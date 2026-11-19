import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import {
  buildSetKeySkillsScript,
  compareSkillLists,
  ensureProfilePage,
  normalizeSkillList,
  readKeySkills,
} from './shared.js';

function formatDiffList(values) {
  return values.length ? values.join(', ') : 'none';
}

cli({
  site: 'naukri',
  name: 'key-skills-set',
  access: 'write',
  description: 'Replace Naukri key skills and verify the final saved chips',
  domain: 'www.naukri.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'skills', type: 'str', required: true, help: 'Comma, semicolon, or newline separated final Naukri key skill labels' },
  ],
  columns: ['status', 'skills', 'missing', 'extra'],
  func: async (page, kwargs) => {
    if (!page) throw new CommandExecutionError('Browser session required for naukri key-skills-set');
    const skills = normalizeSkillList(kwargs.skills);
    if (!skills.length) throw new ArgumentError('--skills is required');
    await ensureProfilePage(page);
    const result = await page.evaluate(buildSetKeySkillsScript(skills));
    if (!result?.ok) {
      throw new CommandExecutionError(
        `Could not update Naukri key skills: ${result?.error || 'skill_add_failed'}`,
        JSON.stringify(result?.failures || result || {}, null, 2),
      );
    }
    await page.wait(4);
    const savedSkills = await readKeySkills(page);
    const diff = compareSkillLists(skills, savedSkills);
    if (diff.missing.length || diff.extra.length) {
      throw new CommandExecutionError(
        'Naukri key skills did not match after save',
        `Missing: ${formatDiffList(diff.missing)}; Extra: ${formatDiffList(diff.extra)}`,
      );
    }
    return [{
      status: 'updated',
      skills: savedSkills.join(', '),
      missing: '',
      extra: '',
    }];
  },
});

export const __test__ = {
  compareSkillLists,
  formatDiffList,
};
