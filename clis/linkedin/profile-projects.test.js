import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import './profile-projects.js';

const { normalizeProfileUrl, profileProjectsUrl, parseProjectText, parseProjectsSectionText, decodeLinkedInSafetyUrl, normalizeProject } = await import('./profile-projects.js').then((m) => m.__test__);

describe('linkedin profile-projects adapter', () => {
  const command = getRegistry().get('linkedin/profile-projects');

  it('registers command shape', () => {
    expect(command).toBeDefined();
    expect(command.strategy).toBe('cookie');
    expect(command.browser).toBe(true);
    expect(command.columns).toEqual([
      'rank',
      'title',
      'date_range',
      'associated_with',
      'description',
      'skills',
      'media',
      'urls',
      'profile_url',
      'raw_text',
    ]);
  });

  it('normalizes default and explicit profile URLs', () => {
    expect(normalizeProfileUrl(undefined)).toBe('https://www.linkedin.com/in/me/');
    expect(normalizeProfileUrl('https://www.linkedin.com/in/gauravsaxena1997?x=1')).toBe('https://www.linkedin.com/in/gauravsaxena1997?x=1');
    expect(profileProjectsUrl('https://www.linkedin.com/in/gauravsaxena1997?x=1')).toBe('https://www.linkedin.com/in/gauravsaxena1997/details/projects/');
  });

  it('rejects non-profile URLs', () => {
    expect(() => normalizeProfileUrl('https://www.linkedin.com/jobs/')).toThrow(CommandExecutionError);
    expect(() => profileProjectsUrl('https://www.linkedin.com/in/me/')).toThrow(CommandExecutionError);
  });

  it('parses visible project text into fields', () => {
    expect(parseProjectText(`OpenCLI Contributions
Jan 2026 - Present
Associated with Open Source
Browser automation and CLI adapter work
Skills: JavaScript, Browser Automation`, 'https://www.linkedin.com/in/me/', 0)).toMatchObject({
      rank: 1,
      title: 'OpenCLI Contributions',
      date_range: 'Jan 2026 - Present',
      associated_with: 'Open Source',
      description: 'Browser automation and CLI adapter work',
      skills: 'JavaScript, Browser Automation',
    });
  });

  it('parses a LinkedIn projects section rendered as one section', () => {
    const rows = parseProjectsSectionText(`Projects

Data Lake

May 2018 – Present

Associated with AdHoc Networks, Jaipur

Show project

Data Lake is a Data consolidation project.
- It provide HDFS services with Docker and VM.

Karyavahi

May 2017 – Present

Associated with Jaipur Engineering College & Research Center,jaipur

Show project

A social media for social issues.
Framework Used: Django , Bootstrap

Who your viewers also viewed`, 'https://www.linkedin.com/in/gauravsaxena1997/');

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      title: 'Data Lake',
      date_range: 'May 2018 – Present',
      associated_with: 'AdHoc Networks, Jaipur',
      description: 'Data Lake is a Data consolidation project. - It provide HDFS services with Docker and VM.',
    });
    expect(rows[1]).toMatchObject({
      title: 'Karyavahi',
      date_range: 'May 2017 – Present',
      associated_with: 'Jaipur Engineering College & Research Center,jaipur',
      description: 'A social media for social issues. Framework Used: Django , Bootstrap',
    });
  });

  it('normalizes rows and requires a title', () => {
    expect(() => normalizeProject({ title: '' })).toThrow(CommandExecutionError);
    expect(normalizeProject({ rank: '2', title: ' Moniqo ', urls: ' https://example.com ' }))
      .toMatchObject({ rank: 2, title: 'Moniqo', urls: 'https://example.com/' });
    expect(normalizeProject({ title: ' Moniqo ', urls: 'javascript:alert(1) | https://example.com/demo' }))
      .toMatchObject({ urls: 'https://example.com/demo' });
  });

  it('decodes LinkedIn safety redirect URLs', () => {
    expect(decodeLinkedInSafetyUrl('https://www.linkedin.com/safety/go/?url=https%3A%2F%2Fgithub.com%2Fjackwener%2FOpenCLI&urlhash=x'))
      .toBe('https://github.com/jackwener/OpenCLI');
    expect(decodeLinkedInSafetyUrl('https://www.linkedin.com/safety/go/?url=javascript%3Aalert(1)&urlhash=x'))
      .toBe('');
  });
});
