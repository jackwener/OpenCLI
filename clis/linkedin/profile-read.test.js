import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import './profile-read.js';

const { normalizeProfileReadUrl, normalizeProfile } = await import('./profile-read.js').then((m) => m.__test__);

describe('linkedin profile-read adapter', () => {
  const command = getRegistry().get('linkedin/profile-read');

  it('registers command shape', () => {
    expect(command).toBeDefined();
    expect(command.strategy).toBe('cookie');
    expect(command.browser).toBe(true);
    expect(command.columns).toEqual([
      'profile_url',
      'name',
      'headline',
      'location',
      'about',
      'about_character_count',
      'about_skills',
      'experience',
      'education',
      'services',
      'featured',
    ]);
  });

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
