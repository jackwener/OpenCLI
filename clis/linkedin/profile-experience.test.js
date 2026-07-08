import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import './profile-experience.js';

const {
  normalizeProfileUrl,
  profileExperienceUrl,
  decodeLinkedInSafetyUrl,
  parseDateRangeParts,
  parseCompanyLine,
  parseLocationLine,
  parseExperienceText,
  parseExperienceSectionText,
  buildExperienceExtractionScript,
  buildDialogExtractionScript,
  normalizeExperience,
} = await import('./profile-experience.js').then((m) => m.__test__);

describe('linkedin profile-experience adapter', () => {
  const command = getRegistry().get('linkedin/profile-experience');

  it('registers command shape', () => {
    expect(command).toBeDefined();
    expect(command.strategy).toBe('cookie');
    expect(command.browser).toBe(true);
    expect(command.columns).toEqual([
      'rank',
      'total_count',
      'title',
      'employment_type',
      'company',
      'date_range',
      'start_date',
      'end_date',
      'location',
      'location_type',
      'description',
      'skills',
      'media',
      'urls',
      'skill_url',
      'media_url',
      'profile_url',
      'raw_text',
    ]);
  });

  it('normalizes default and explicit profile URLs', () => {
    expect(normalizeProfileUrl(undefined)).toBe('https://www.linkedin.com/in/me/');
    expect(normalizeProfileUrl('https://www.linkedin.com/in/gauravsaxena1997?x=1')).toBe('https://www.linkedin.com/in/gauravsaxena1997?x=1');
    expect(profileExperienceUrl('https://www.linkedin.com/in/gauravsaxena1997?x=1')).toBe('https://www.linkedin.com/in/gauravsaxena1997/details/experience/');
  });

  it('rejects non-profile URLs', () => {
    expect(() => normalizeProfileUrl('https://www.linkedin.com/jobs/')).toThrow(CommandExecutionError);
    expect(() => profileExperienceUrl('https://www.linkedin.com/in/me/')).toThrow(CommandExecutionError);
  });

  it('parses company, date, and location line variants', () => {
    expect(parseCompanyLine('Self Employed · Freelance')).toEqual({
      company: 'Self Employed',
      employment_type: 'Freelance',
    });
    expect(parseDateRangeParts('Feb 2026 – Present · 4 mos')).toEqual({
      dateRange: 'Feb 2026 – Present',
      startDate: 'Feb 2026',
      endDate: 'Present',
    });
    expect(parseLocationLine('Jaipur, Rajasthan, India · Remote')).toEqual({
      location: 'Jaipur, Rajasthan, India',
      location_type: 'Remote',
    });
  });

  it('parses visible experience text into fields', () => {
    expect(parseExperienceText(`Senior Full-Stack AI Engineer
Self Employed · Freelance
Feb 2026 – Present · 4 mos
Jaipur, Rajasthan, India · Remote
Building AI-enabled SaaS products and agentic workflows.
Skills: Generative AI, Next.js, TypeScript`, 'https://www.linkedin.com/in/me/', 0, 1)).toMatchObject({
      rank: 1,
      total_count: 1,
      title: 'Senior Full-Stack AI Engineer',
      employment_type: 'Freelance',
      company: 'Self Employed',
      date_range: 'Feb 2026 – Present',
      start_date: 'Feb 2026',
      end_date: 'Present',
      location: 'Jaipur, Rajasthan, India',
      location_type: 'Remote',
      description: 'Building AI-enabled SaaS products and agentic workflows.',
      skills: 'Generative AI, Next.js, TypeScript',
    });
  });

  it('parses a LinkedIn experience section rendered as one section', () => {
    const rows = parseExperienceSectionText(`Experience

Senior Software Engineer
Zetwerk Manufacturing
Apr 2022 – Present · 4 yrs 2 mos
Bengaluru, Karnataka, India · Hybrid
Led development and mentored team members.
Skills: Angular, Node.js

Software Engineer
OnGraph Technologies Pvt. Ltd.
Jun 2019 – Apr 2022 · 2 yrs 11 mos
Jaipur, Rajasthan, India · On-site
Full-stack development for client projects.
Skills: React, MongoDB

Who your viewers also viewed`, 'https://www.linkedin.com/in/gauravsaxena1997/');

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      total_count: 2,
      title: 'Senior Software Engineer',
      company: 'Zetwerk Manufacturing',
      date_range: 'Apr 2022 – Present',
      location_type: 'Hybrid',
    });
    expect(rows[1]).toMatchObject({
      total_count: 2,
      title: 'Software Engineer',
      company: 'OnGraph Technologies Pvt. Ltd.',
      date_range: 'Jun 2019 – Apr 2022',
      location_type: 'On-site',
    });
  });

  it('normalizes rows and requires a title', () => {
    expect(() => normalizeExperience({ title: '' })).toThrow(CommandExecutionError);
    expect(normalizeExperience({ rank: '2', total_count: '4', title: ' AI Engineer ', company: ' Self Employed ', skill_url: ' https://example.com/skills ' }))
      .toMatchObject({ rank: 2, total_count: 4, title: 'AI Engineer', company: 'Self Employed', skill_url: 'https://example.com/skills' });
  });

  it('decodes LinkedIn safety redirect URLs', () => {
    expect(decodeLinkedInSafetyUrl('https://www.linkedin.com/safety/go/?url=https%3A%2F%2Fexample.com%2Fdemo&urlhash=x'))
      .toBe('https://example.com/demo');
    expect(decodeLinkedInSafetyUrl('https://www.linkedin.com/safety/go/?url=javascript%3Aalert(1)&urlhash=x'))
      .toBe('');
    expect(decodeLinkedInSafetyUrl('javascript:alert(1)')).toBe('');
  });

  it('builds browser extraction scripts that parse as JavaScript', () => {
    expect(() => new Function(buildExperienceExtractionScript())).not.toThrow();
    expect(() => new Function(buildDialogExtractionScript())).not.toThrow();
  });
});
