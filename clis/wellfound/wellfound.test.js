import { describe, expect, it } from 'vitest';
import {
  buildDetailUrl,
  assertExpectedApplyTarget,
  buildFilterConfig,
  inferJobType,
  isTopPickHardReject,
  normalizeApplyState,
  normalizeCompanyStatus,
  normalizeDetailRow,
  normalizeFilterState,
  normalizeJobRow,
  normalizeJobSlug,
  normalizeApplyMessage,
  parseLimit,
  topPickScoreMultiplier,
  scoreJob,
} from './utils.js';

describe('wellfound url helpers', () => {
  it('accepts raw slugs, detail urls, and dialog urls', () => {
    expect(normalizeJobSlug('3143348-staff-software-engineer')).toBe('3143348-staff-software-engineer');
    expect(normalizeJobSlug('https://wellfound.com/jobs/3143348-staff-software-engineer')).toBe('3143348-staff-software-engineer');
    expect(normalizeJobSlug('https://wellfound.com/jobs?job_listing_slug=3143348-staff-software-engineer')).toBe('3143348-staff-software-engineer');
    expect(buildDetailUrl('3143348-staff-software-engineer')).toBe('https://wellfound.com/jobs/3143348-staff-software-engineer');
  });

  it('rejects invalid limits without silently clamping user input', () => {
    expect(parseLimit(undefined, 5, 20)).toBe(5);
    expect(() => parseLimit(0, 5, 20)).toThrow(/between 1 and 20/);
    expect(() => parseLimit(21, 5, 20)).toThrow(/between 1 and 20/);
  });
});

describe('wellfound row normalization', () => {
  it('normalizes a visible job card and scores useful application signals', () => {
    const row = normalizeJobRow({
      title: 'AI Full Stack Engineer, Platform',
      company: 'ParallelDots',
      location: 'Remote only • India',
      compensation: '₹45L – ₹1.2 cr • 0.0% – 0.5%',
      posted: 'Posted today',
      recruiter_active: true,
      apply_on_wellfound: true,
      company_status: 'actively_hiring',
      company_summary: 'Transforming FMCG industry through computer vision',
      company_size: '501-1000 Employees',
      url: '/jobs/4215150-ai-full-stack-engineer-platform',
      company_url: '/company/paralleldots',
      raw: 'AI Full Stack Engineer, Platform Remote only • India • ₹45L – ₹1.2 cr • Recruiter recently active Posted today',
    });

    expect(row).toMatchObject({
      rank: 1,
      title: 'AI Full Stack Engineer, Platform',
      company: 'ParallelDots',
      location: 'Remote only • India',
      compensation: '₹45L – ₹1.2 cr • 0.0% – 0.5%',
      recruiter_active: 'yes',
      apply_on_wellfound: 'yes',
      company_status: 'actively_hiring',
      url: 'https://wellfound.com/jobs/4215150-ai-full-stack-engineer-platform',
      company_url: 'https://wellfound.com/company/paralleldots',
    });
    expect(row.score).toBeGreaterThan(70);
  });

  it('splits collapsed Wellfound card text from browser extraction', () => {
    const row = normalizeJobRow({
      title: 'AI Full Stack Engineer, Platform Remote onlyIndia₹15L – ₹18L',
      company: 'ParallelDots',
      location: 'AI Full Stack Engineer, Platform Remote onlyIndia₹15L – ₹18L',
      compensation: 'AI Full Stack Engineer, Platform Remote onlyIndia₹15L – ₹18L',
      posted: 'POSTED TODAY',
      recruiter_active: true,
      apply_on_wellfound: true,
      url: '/jobs/4215150-ai-full-stack-engineer-platform',
      raw: 'AI Full Stack Engineer, Platform Remote onlyIndia₹15L – ₹18L Recruiter recently active POSTED TODAY',
    });

    expect(row.title).toBe('AI Full Stack Engineer, Platform');
    expect(row.location).toBe('Remote only • India');
    expect(row.compensation).toBe('₹15L – ₹18L');
  });

  it('infers flexible work types from titles and details', () => {
    expect(inferJobType('Founding Engineer - Part Time (Equity only)')).toBe('Part Time');
    expect(inferJobType('Senior React Contract Developer')).toBe('Contract');
    expect(inferJobType('Freelance AI Engineer')).toBe('Freelance');
  });

  it('penalizes unpaid or equity-only roles', () => {
    const paid = scoreJob({ title: 'AI Engineer', location: 'Remote only', posted: 'Posted today', recruiter_active: true, raw: '₹45L' });
    const unpaid = scoreJob({ title: 'AI Intern', location: 'Remote only', posted: 'Posted today', recruiter_active: true, raw: 'unpaid equity only' });
    expect(paid).toBeGreaterThan(unpaid);
  });

  it('down-ranks internships and very low compensation for AI/full-stack remote shortlists', () => {
    const senior = scoreJob({ title: 'Full-Stack AI Engineer', location: 'Remote only India', posted: 'Posted today', recruiter_active: true, raw: '₹45L – ₹1.2 cr React Node AI' });
    const intern = scoreJob({ title: 'Full Stack AI Engineer Intern', location: 'Remote only India', posted: 'Posted today', recruiter_active: true, raw: '₹8,000 – ₹15,000 Internship' });
    const low = scoreJob({ title: 'Full-Stack Engineer', location: 'Remote only India', posted: 'Posted today', recruiter_active: true, raw: '₹3L – ₹4L' });

    expect(senior).toBeGreaterThan(intern);
    expect(senior).toBeGreaterThan(low);
  });

  it('hard rejects disallowed and Python-only roles in top-picks filtering', () => {
    expect(isTopPickHardReject({
      title: 'Principal Backend Engineer (Go)',
      raw: 'Go distributed systems · Kubernetes',
      company_summary: 'building GTM context graph for revenue teams',
    })).toBe(true);

    expect(isTopPickHardReject({
      title: 'Senior Python Backend Developer',
      raw: 'Python backend role building APIs for internal reporting',
      company_summary: 'Django + PostgreSQL',
    })).toBe(true);

    expect(isTopPickHardReject({
      title: 'AI Full Stack Engineer',
      raw: 'TypeScript · Node.js · React · MCP',
      company_summary: 'AI workflow platform',
    })).toBe(false);
  });

  it('hard rejects jobs from closed companies', () => {
    expect(isTopPickHardReject({
      title: 'AI Full Stack Engineer',
      raw: 'TypeScript · Node.js · React · MCP',
      company_summary: 'AI workflow platform',
      company_status: 'closed',
    })).toBe(true);
  });

  it('boosts top-picks for AI + TypeScript/React/Next alignment', () => {
    const aligned = topPickScoreMultiplier({
      title: 'AI Product Engineer',
      raw: 'MCP AI platform with React and TypeScript',
      company_summary: 'Workflow automation',
      location: 'Remote only',
    });
    const generic = topPickScoreMultiplier({
      title: 'Backend Engineer',
      raw: 'Backend Java APIs',
      company_summary: 'General services',
      location: 'Remote only',
    });

    expect(aligned).toBeGreaterThan(generic);
  });
});

describe('wellfound detail normalization', () => {
  it('normalizes detail dialog payload', () => {
    const row = normalizeDetailRow({
      title: 'Staff Software Engineer',
      company: 'Allminds',
      company_url: '/company/allminds-2',
      details: '$45k – $80k • 0.005% – 0.05% | Remote (India) | 4 years of exp | Full Time',
      compensation: '$45k – $80k • 0.005% – 0.05%',
      location: 'Remote (India)',
      experience: '4 years of exp',
      job_type: 'Full Time',
      posted: 'Reposted: 2 weeks ago',
      recruiter_active: true,
      remote_policy: 'Remote only',
      company_location: 'San Francisco',
      visa_sponsorship: 'Not Available',
      preferred_timezones: 'Eastern Time, Indochina Time',
      collaboration_hours: '8:00 AM - 6:00 PM Indochina Time',
      relocation: 'Not Allowed',
      company_status: 'Closed',
      skills: 'Node.js Firebase React.js',
      company_size: '11-50',
      company_industries: 'Healthcare; Artificial Intelligence',
      description: 'Build mental healthcare software.',
      url: 'https://wellfound.com/jobs?job_listing_slug=3143348-staff-software-engineer',
    });

    expect(row).toMatchObject({
      title: 'Staff Software Engineer',
      company: 'Allminds',
      location: 'Remote (India)',
      compensation: '$45k – $80k • 0.005% – 0.05%',
      job_type: 'Full Time',
      experience: '4 years of exp',
      posted: 'Reposted 2 weeks ago',
      recruiter_active: 'yes',
      remote_policy: 'Remote only',
      company_status: 'closed',
      company_url: 'https://wellfound.com/company/allminds-2',
    });
  });

  it('normalizes company status badges from Wellfound pages', () => {
    expect(normalizeCompanyStatus('Closed')).toBe('closed');
    expect(normalizeCompanyStatus('Actively Hiring')).toBe('actively_hiring');
    expect(normalizeCompanyStatus('')).toBe('');
  });
});

describe('wellfound apply helpers', () => {
  it('normalizes Wellfound-native and external apply states', () => {
    const multilineMessage = [
      'I build agentic workflow products.',
      'Portfolio: https://example.com',
      'GitHub: https://github.com/example',
    ].join('\n');

    expect(normalizeApplyState({
      status: 'ready',
      apply_mode: 'wellfound',
      title: 'AI Agents Engineer',
      company: 'Memorang',
      message: multilineMessage,
      message_filled: 'yes',
      message_length: multilineMessage.length,
      url: 'https://wellfound.com/jobs?job_listing_slug=4287201-ai-agents-engineer',
    })).toMatchObject({
      status: 'ready',
      apply_mode: 'wellfound',
      title: 'AI Agents Engineer',
      company: 'Memorang',
      message: multilineMessage,
      message_filled: 'yes',
      message_length: String(multilineMessage.length),
    });

    expect(normalizeApplyState({
      apply_mode: 'company_website',
      title: 'External Role',
      company: 'Example',
      external_apply_url: 'https://example.com/apply',
      url: 'https://wellfound.com/jobs?job_listing_slug=1-external-role',
    }).external_apply_url).toBe('https://example.com/apply');
  });

  it('preserves intentional line breaks in apply messages', () => {
    expect(normalizeApplyMessage('  Why fit  \n\n Portfolio: https://example.com \n GitHub: https://github.com/example  ')).toBe([
      'Why fit',
      '',
      'Portfolio: https://example.com',
      'GitHub: https://github.com/example',
    ].join('\n'));
  });

  it('guards apply target by exact expected title and company', () => {
    const state = normalizeApplyState({
      title: 'AI Agents Engineer',
      company: 'Memorang',
      url: 'https://wellfound.com/jobs?job_listing_slug=4287201-ai-agents-engineer',
    });
    expect(() => assertExpectedApplyTarget(state, 'AI Agents Engineer', 'Memorang')).not.toThrow();
    expect(() => assertExpectedApplyTarget(state, 'Backend Engineer', 'Memorang')).toThrow(/expected title/);
    expect(() => assertExpectedApplyTarget(state, 'AI Agents Engineer', 'OtherCo')).toThrow(/expected company/);
  });
});

describe('wellfound filters helpers', () => {
  it('builds the AI full-stack remote preset without requiring UI mutation', () => {
    const config = buildFilterConfig({ preset: 'ai-fullstack-remote' });
    expect(config.jobTypes).toEqual(['Full Time', 'Contract']);
    expect(config.skills).toContain('TypeScript');
    expect(config.includedKeywords.join(' ')).toMatch(/AI|agentic|Gen AI/);
    expect(config.hideCompanyApply).toBe(true);
  });

  it('normalizes filter readback rows', () => {
    const row = normalizeFilterState({
      status: 'dry-run',
      results: '111 results',
      role: 'Full-Stack Engineer',
      remote: 'Remote only',
      region: 'Asia',
      job_types: ['Full Time', 'Contract'],
      company_size: ['1-10 employees', '11-50 employees'],
      investment_stage: ['Seed Stage'],
      remote_culture: 'yes',
      responsiveness: 'yes',
      visa_sponsorship: 'no',
      hide_company_apply: 'visible',
      url: 'https://wellfound.com/jobs',
    });

    expect(row).toMatchObject({
      status: 'dry-run',
      results: '111 results',
      role: 'Full-Stack Engineer',
      remote: 'Remote only',
      region: 'Asia',
      job_types: 'Full Time; Contract',
      hide_company_apply: 'visible',
    });
  });
});
