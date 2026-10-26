import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import './profile-experience.js';

const {
  normalizeProfileUrl,
  profileExperienceUrl,
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

  it('parses grouped company experience layout without shifting title and company', () => {
    const text = `Full-time · 4 yrs 9 mos
UX Designer II at Microsoft AI
Sep 2022 – Present · 4 yrs
Redmond, Washington, United States · Hybrid
Designing AI-driven user experiences.`;
    const parsed = parseExperienceText(text, 'https://www.linkedin.com/in/me/', 0, 1);
    expect(parsed.title).toBe('UX Designer II at Microsoft AI');
    expect(parsed.employment_type).toBe('Full-time');
    expect(parsed.company).toBe('Microsoft AI');
    expect(parsed.location).toBe('Redmond, Washington, United States');
    expect(parsed.location_type).toBe('Hybrid');
    expect(parsed.description).toBe('Designing AI-driven user experiences.');
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

  it.each(['Contract Manager', 'Freelance Designer', 'Engineer with 5 yrs experience'])(
    'preserves the actual role title %s in text and browser extraction', (title) => {
      const raw = `${title}\nAcme · Full-time\nJan 2020 – Present\nRemote\nBuilds useful tools.`;
      expect(parseExperienceText(raw, 'https://www.linkedin.com/in/test/', 0)).toMatchObject({ title, company: 'Acme' });
      const dom = new JSDOM('<main><article><a href="/in/test/details/experience/edit/forms/1/">Edit</a></article></main>', {
        url: 'https://www.linkedin.com/in/test/details/experience/', runScripts: 'outside-only',
      });
      Object.defineProperty(dom.window.document.querySelector('article'), 'innerText', { value: raw });
      try {
        const result = dom.window.eval(buildExperienceExtractionScript());
        expect(result.experienceRows).toHaveLength(1);
        expect(result.experienceRows[0]).toMatchObject({ title, company: 'Acme', employment_type: 'Full-time' });
      } finally { dom.window.close(); }
    },
  );

  it('extracts separate grouped roles using company context in the browser', () => {
    const dom = new JSDOM('<main><section><a href="/company/acme/"><p>Acme</p></a><ul><li><a href="/in/test/details/experience/edit/forms/1/">Edit</a></li><li><a href="/in/test/details/experience/edit/forms/2/">Edit</a></li></ul></section></main>', {
      url: 'https://www.linkedin.com/in/test/details/experience/', runScripts: 'outside-only',
    });
    const texts = ['Full-time · 4 yrs 9 mos\nSenior Engineer\nJan 2022 – Present\nRemote\nBuilds systems.', 'Contract · 1 yr\nEngineer\nJan 2021 – Jan 2022\nRemote\nBuilt services.'];
    [...dom.window.document.querySelectorAll('li')].forEach((node, index) => {
      Object.defineProperty(node, 'innerText', { value: texts[index] });
    });
    try {
      const rows = dom.window.eval(buildExperienceExtractionScript()).experienceRows;
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ title: 'Senior Engineer', company: 'Acme', employment_type: 'Full-time', description: 'Builds systems.' });
      expect(rows[1]).toMatchObject({ title: 'Engineer', company: 'Acme', employment_type: 'Contract', description: 'Built services.' });
    } finally { dom.window.close(); }
  });

  it('normalizes rows and requires a title', () => {
    expect(() => normalizeExperience({ title: '' })).toThrow(CommandExecutionError);
    expect(normalizeExperience({ rank: '2', total_count: '4', title: ' AI Engineer ', company: ' Self Employed ', skill_url: ' https://example.com/skills ' }))
      .toMatchObject({ rank: 2, total_count: 4, title: 'AI Engineer', company: 'Self Employed', skill_url: 'https://example.com/skills' });
  });

  it('builds browser extraction scripts that parse as JavaScript', () => {
    expect(() => new Function(buildExperienceExtractionScript())).not.toThrow();
    expect(() => new Function(buildDialogExtractionScript())).not.toThrow();
  });
});
