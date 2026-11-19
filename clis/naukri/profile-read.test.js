import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { AuthRequiredError } from '@jackwener/opencli/errors';
import { PROFILE_COLUMNS } from './profile-read.js';
import './profile-read.js';

const { parseResumeSection, parseNaukriProfileText } = await import('./profile-read.js').then((m) => m.__test__);
const { normalizeSkillList } = await import('./shared.js');

const PROFILE_TEXT = `
Gaurav Saxena
Senior Software Engineer
at Zetwerk Manufacturing
Profile last updated - Today
100 %
Approval Pending
Jaipur, INDIA
6 Year(s) 6 Month(s)
₹ 20,00,000
7976761580
gauravsaxena.jaipur@gmail.com
Serving Notice Period
Quick links
Resume
Resume headline
Key skills
Employment
Education
IT skills
Projects
Profile summary
Resume
gaurav-saxena-senior-full-stack-ai-engineer-cv.pdf
Uploaded on  May 26, 2026
downloadOneTheme
deleteOneTheme
Update resume
Supported Formats: doc, docx, rtf, pdf, upto 2 MB
Resume headline
editOneTheme
Full Stack Dev | Node.js, React, Angular, MongoDB | Build scalable apps
Key skills
editOneTheme
Ionic Framework
Full Stack Web Development
Software Development
AWS
Employment
Add employment
Senior Software Engineer editOneTheme Zetwerk Manufacturing Full-time Apr 2022 to Present (4 years 2 months) Serving Notice Period
Education
Add education
B.Tech / B.E.
Computer Science and Engineering (CSE)
Jaipur Engineering College and Research Centre 2015- 2019 Full Time
IT skills
Add details
Skills Version Last used Experience
AWS - 2025 1 Year 0 Month editOneTheme
Node.js - 2025 5 Years 0 Month editOneTheme
Projects
Add project
Stand out to employers by adding details about projects that you have done so far
Profile summary
editOneTheme
Experienced Senior Software Engineer with a proven track record of leading development efforts.
Accomplishments
Online profile
Portfolio editOneTheme
gauravsaxena.tech
Career profile
editOneTheme
Current industry Internet Department Engineering - Software & QA Role category Software Development Job role Full Stack Developer
Personal details
editOneTheme
Personal
male, Single / unmarried
Date of birth
14 Oct 1997
Diversity & inclusion
Disability status
Do not have disability
Military experience
Never served
`;

describe('naukri profile-read adapter', () => {
  const command = getRegistry().get('naukri/profile-read');

  it('registers command shape', () => {
    expect(command).toBeDefined();
    expect(command.access).toBe('read');
    expect(command.strategy).toBe('cookie');
    expect(command.browser).toBe(true);
    expect(command.navigateBefore).toBe(false);
    expect(command.columns).toEqual(PROFILE_COLUMNS);
  });

  it('parses resume filename and upload date', () => {
    expect(parseResumeSection('gaurav.pdf Uploaded on May 26, 2026 downloadOneTheme')).toEqual({
      resume_file: 'gaurav.pdf',
      resume_uploaded_on: 'May 26, 2026',
    });
  });

  it('extracts visible profile sections into one row', () => {
    const row = parseNaukriProfileText({
      url: 'https://www.naukri.com/mnjuser/profile?id=&altresid',
      title: 'Profile | Mynaukri',
      text: PROFILE_TEXT,
    });
    expect(Object.keys(row)).toEqual(PROFILE_COLUMNS);
    expect(row).toMatchObject({
      profile_url: 'https://www.naukri.com/mnjuser/profile?id=&altresid',
      name: 'Gaurav Saxena',
      current_title: 'Senior Software Engineer',
      current_company: 'Zetwerk Manufacturing',
      profile_last_updated: 'Today',
      profile_completion: '100 %',
      photo_status: 'Approval Pending',
      location: 'Jaipur, INDIA',
      total_experience: '6 Year(s) 6 Month(s)',
      current_salary: '₹ 20,00,000',
      phone: '7976761580',
      email: 'gauravsaxena.jaipur@gmail.com',
      notice_status: 'Serving Notice Period',
      resume_file: 'gaurav-saxena-senior-full-stack-ai-engineer-cv.pdf',
      resume_uploaded_on: 'May 26, 2026',
      resume_headline: 'Full Stack Dev | Node.js, React, Angular, MongoDB | Build scalable apps',
    });
    expect(row.key_skills).toContain('Full Stack Web Development');
    expect(row.employment).toContain('Zetwerk Manufacturing');
    expect(row.education).toContain('Jaipur Engineering College');
    expect(row.it_skills).toContain('Node.js - 2025 5 Years 0 Month');
    expect(row.projects).toContain('Stand out to employers');
    expect(row.profile_summary).toContain('Experienced Senior Software Engineer');
    expect(row.accomplishments).toContain('gauravsaxena.tech');
    expect(row.career_profile).toContain('Full Stack Developer');
    expect(row.personal_details).toContain('14 Oct 1997');
    expect(row.diversity_inclusion).toContain('Do not have disability');
  });

  it('uses DOM key-skill chips when available', () => {
    const row = parseNaukriProfileText({
      url: 'https://www.naukri.com/mnjuser/profile',
      title: 'Profile | Mynaukri',
      text: PROFILE_TEXT.replace('Ionic Framework\nFull Stack Web Development\nSoftware Development\nAWS', 'Ionic FrameworkFull Stack Web DevelopmentSoftware DevelopmentAWS'),
      keySkills: ['Ionic Framework', 'Full Stack Web Development', 'Software Development', 'AWS'],
    });

    expect(row.key_skills).toBe('Ionic Framework, Full Stack Web Development, Software Development, AWS');
  });

  it('normalizes skill lists', () => {
    expect(normalizeSkillList([' React ', 'react', 'Node.js', ''])).toEqual(['React', 'Node.js']);
    expect(normalizeSkillList('React, Node.js; TypeScript')).toEqual(['React', 'Node.js', 'TypeScript']);
  });

  it('raises auth required on login page text', () => {
    expect(() => parseNaukriProfileText({
      title: 'Login | Naukri',
      text: 'Login Sign in Forgot password',
    })).toThrow(AuthRequiredError);
  });

  it('drives browser to Mynaukri profile page and returns parsed row', async () => {
    const page = {
      goto: vi.fn(async () => {}),
      wait: vi.fn(async () => {}),
      autoScroll: vi.fn(async () => {}),
      evaluate: vi.fn(async () => ({
        url: 'https://www.naukri.com/mnjuser/profile',
        title: 'Profile | Mynaukri',
        text: PROFILE_TEXT,
      })),
    };

    await expect(command.func(page)).resolves.toMatchObject([{ name: 'Gaurav Saxena' }]);
    expect(page.goto).toHaveBeenCalledWith('https://www.naukri.com/mnjuser/profile');
    expect(page.autoScroll).toHaveBeenCalled();
  });
});
