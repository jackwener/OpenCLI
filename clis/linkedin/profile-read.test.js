import { describe, expect, it } from 'vitest';

import { CommandExecutionError } from '@jackwener/opencli/errors';

const { normalizeProfileReadUrl, normalizeProfile } = await import('./profile-read.js').then((m) => m.__test__);

describe('linkedin profile-read adapter', () => {

  it('normalizes profile url default and explicit /in URL', () => {
    expect(normalizeProfileReadUrl(undefined)).toBe('https://www.linkedin.com/in/me/');
    expect(normalizeProfileReadUrl('https://www.linkedin.com/in/gauravsaxena1997?x=1')).toBe('https://www.linkedin.com/in/gauravsaxena1997?x=1');
  });

  it('rejects non-profile URLs', () => {
    expect(() => normalizeProfileReadUrl('https://www.linkedin.com/jobs/')).toThrow(CommandExecutionError);
  });

  it('normalizes duplicated profile text and requires a name', () => {
    expect(() => normalizeProfile({ name: '' })).toThrow(CommandExecutionError);
    expect(normalizeProfile({
      name: 'AliceAlice',
      headline: 'EngineerEngineer',
      about: '  Builds AI  ',
      about_character_count: '1,100/2,600',
      about_skills: ['AI', 'TypeScript'],
    })).toMatchObject({
      name: 'Alice',
      headline: 'Engineer',
      about: 'Builds AI',
      about_character_count: '1,100/2,600',
      about_skills: 'AI; TypeScript',
    });
  });

});
