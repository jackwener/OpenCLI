import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import './job-detail.js';

const {
  parseJobId,
  normalizeJobUrl,
  buildJobPostingPath,
  fetchJobPosting,
  mapJobPosting,
  decodeLinkedinRedirect,
  normalizeDetail,
} = await import('./job-detail.js').then((m) => m.__test__);

const JOB_URL = 'https://www.linkedin.com/jobs/view/4477097828/';

function plainPosting(overrides = {}) {
  return {
    title: 'Senior Backend Engineer',
    description: { text: 'Build   the\nplatform.' },
    formattedLocation: 'Berlin, Germany',
    formattedEmploymentStatus: 'Full-time',
    workplaceTypes: ['urn:li:fs_workplaceType:3'],
    workplaceTypesResolutionResults: {
      'urn:li:fs_workplaceType:3': { localizedName: 'Hybrid', entityUrn: 'urn:li:fs_workplaceType:3' },
    },
    listedAt: Date.UTC(2026, 10, 3, 9, 30),
    applies: 0,
    jobState: 'LISTED',
    applyMethod: {
      'com.linkedin.voyager.jobs.OffsiteApply': { companyApplyUrl: 'https://careers.example.com/jobs/42' },
    },
    companyDetails: {
      'com.linkedin.voyager.deco.jobs.web.shared.WebJobPostingCompany': {
        company: 'urn:li:fs_normalized_company:1001',
        companyResolutionResult: { name: 'Acme GmbH', url: 'https://www.linkedin.com/company/acme/' },
      },
    },
    ...overrides,
  };
}

function makePage({ pageRow = { title: '' }, fetched = { json: plainPosting() }, cookies = [{ name: 'JSESSIONID', value: '"ajax:123"' }] } = {}) {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
    getCookies: vi.fn().mockResolvedValue(cookies),
    evaluate: vi.fn()
      .mockResolvedValueOnce(false) // auth probe
      .mockResolvedValueOnce(pageRow) // rendered-page extraction
      .mockResolvedValueOnce(fetched), // jobPostings fetch
  };
}

describe('linkedin job-detail adapter', () => {
  const command = getRegistry().get('linkedin/job-detail');

  it('normalizes exact LinkedIn job urls', () => {
    expect(normalizeJobUrl('https://www.linkedin.com/jobs/view/123456?x=1')).toBe('https://www.linkedin.com/jobs/search/?currentJobId=123456');
  });

  it('rejects non-job URLs', () => {
    expect(() => normalizeJobUrl('https://www.linkedin.com/feed/')).toThrow(ArgumentError);
    expect(() => normalizeJobUrl('https://example.com/jobs/view/1')).toThrow(ArgumentError);
  });

  it('decodes LinkedIn redirect apply urls', () => {
    expect(decodeLinkedinRedirect('https://www.linkedin.com/redir/redirect/?url=https%3A%2F%2Fexample.com%2Fapply')).toBe('https://example.com/apply');
    expect(decodeLinkedinRedirect('https://www.linkedin.com/redir/redirect/?url=javascript%3Aalert(1)')).toBe('');
    expect(decodeLinkedinRedirect('javascript:alert(1)')).toBe('');
  });

  it('requires stable title in extracted detail', () => {
    expect(() => normalizeDetail({ title: '' })).toThrow(CommandExecutionError);
    expect(normalizeDetail({ title: 'Senior Engineer', company: 'Acme', description: 'Build things' }))
      .toMatchObject({ title: 'Senior Engineer', company: 'Acme', description: 'Build things' });
  });

  it('extracts the job id from view and search urls', () => {
    expect(parseJobId('https://www.linkedin.com/jobs/view/4477097828/')).toBe('4477097828');
    expect(parseJobId('https://www.linkedin.com/jobs/search/?currentJobId=55&keywords=x')).toBe('55');
  });

  it('builds the jobPostings path with the pinned decoration id', () => {
    expect(buildJobPostingPath('4477097828')).toBe(
      '/voyager/api/jobs/jobPostings/4477097828?decorationId=com.linkedin.voyager.deco.jobs.web.shared.WebFullJobPosting-65',
    );
  });

  it('maps a plain jobPostings payload', () => {
    expect(mapJobPosting(plainPosting(), '4477097828')).toEqual({
      url: 'https://www.linkedin.com/jobs/view/4477097828/',
      title: 'Senior Backend Engineer',
      company: 'Acme GmbH',
      company_url: 'https://www.linkedin.com/company/acme/',
      location: 'Berlin, Germany',
      workplace_type: 'Hybrid',
      job_type: 'Full-time',
      applicants: '',
      listed: '2026-11-03',
      apply_url: 'https://careers.example.com/jobs/42',
      description: 'Build the platform.',
    });
  });

  it('maps a normalized { data, included } payload by urn', () => {
    const json = {
      data: plainPosting({
        workplaceTypes: ['urn:li:fs_workplaceType:2'],
        workplaceTypesResolutionResults: undefined,
        companyDetails: {
          'com.linkedin.voyager.deco.jobs.web.shared.WebJobPostingCompany': { company: 'urn:li:fs_normalized_company:1001' },
        },
        applyMethod: { 'com.linkedin.voyager.jobs.ComplexOnsiteApply': { easyApplyUrl: 'https://www.linkedin.com/job-apply/4477097828' } },
      }),
      included: [
        { entityUrn: 'urn:li:fs_normalized_company:1001', name: 'Acme GmbH', url: 'https://www.linkedin.com/company/acme/' },
        { entityUrn: 'urn:li:fs_workplaceType:2', localizedName: 'Remote' },
        { $type: 'com.linkedin.voyager.jobs.JobSavingInfo', saved: false },
      ],
    };
    expect(mapJobPosting(json, '4477097828')).toMatchObject({
      title: 'Senior Backend Engineer',
      company: 'Acme GmbH',
      company_url: 'https://www.linkedin.com/company/acme/',
      workplace_type: 'Remote',
      apply_url: 'https://www.linkedin.com/job-apply/4477097828',
    });
  });

  it('falls back to the workplace type code and the plain company name', () => {
    const row = mapJobPosting(plainPosting({
      workplaceTypes: ['urn:li:fs_workplaceType:1'],
      workplaceTypesResolutionResults: undefined,
      companyDetails: { 'com.linkedin.voyager.jobs.JobPostingCompanyName': { companyName: 'Stealth Startup' } },
      applyMethod: undefined,
      listedAt: undefined,
    }), '1');
    expect(row).toMatchObject({ workplace_type: 'On-site', company: 'Stealth Startup', company_url: '', apply_url: '', listed: '' });
  });

  it('returns null for payloads without a title', () => {
    expect(mapJobPosting(null, '1')).toBeNull();
    expect(mapJobPosting({}, '1')).toBeNull();
    expect(mapJobPosting({ data: { title: '   ' } }, '1')).toBeNull();
    expect(mapJobPosting({ title: { text: 'not a string' } }, '1')).toBeNull();
  });

  describe('fetchJobPosting (in-page)', () => {
    afterEach(() => vi.unstubAllGlobals());

    const stubFetch = (response) => vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    const headers = (type) => ({ get: () => type });

    it('returns json and sends the csrf token', async () => {
      stubFetch({ ok: true, status: 200, headers: headers('application/json'), json: async () => ({ title: 'T' }) });
      await expect(fetchJobPosting('/voyager/api/jobs/jobPostings/1', 'ajax:1')).resolves.toEqual({ json: { title: 'T' } });
      expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: 'include', headers: { 'csrf-token': 'ajax:1' } });
    });

    it('flags 401/403 and HTML responses as auth failures', async () => {
      stubFetch({ ok: false, status: 403, headers: headers('application/json') });
      await expect(fetchJobPosting('/x', 'c')).resolves.toMatchObject({ authRequired: true, error: 'HTTP 403' });
      stubFetch({ ok: true, status: 200, headers: headers('text/html; charset=utf-8') });
      await expect(fetchJobPosting('/x', 'c')).resolves.toMatchObject({ authRequired: true });
    });

    it('reports other HTTP errors without claiming auth', async () => {
      stubFetch({ ok: false, status: 400, headers: headers('application/json') });
      await expect(fetchJobPosting('/x', 'c')).resolves.toEqual({ error: 'HTTP 400' });
    });
  });

  describe('func', () => {
    it('reads the job from the jobPostings API when the SDUI page has no title', async () => {
      const page = makePage({ pageRow: { title: '', applicants: 'Over 100 people clicked apply' } });
      const rows = await command.func(page, { 'job-url': JOB_URL });
      expect(rows).toEqual([expect.objectContaining({
        title: 'Senior Backend Engineer',
        company: 'Acme GmbH',
        applicants: 'Over 100 people clicked apply',
        url: 'https://www.linkedin.com/jobs/view/4477097828/',
      })]);
      expect(page.goto).toHaveBeenCalledWith('https://www.linkedin.com/jobs/search/?currentJobId=4477097828');
      const fetchScript = page.evaluate.mock.calls[2][0];
      expect(fetchScript).toContain('/voyager/api/jobs/jobPostings/4477097828?decorationId=');
      expect(fetchScript).toContain('"ajax:123"');
    });

    it('falls back to the rendered page when the API call fails', async () => {
      const page = makePage({ pageRow: { title: 'Data Engineer', company: 'Initech' }, fetched: { error: 'HTTP 400' } });
      const rows = await command.func(page, { 'job-url': JOB_URL });
      expect(rows).toEqual([expect.objectContaining({ title: 'Data Engineer', company: 'Initech' })]);
    });

    it('names the API failure when neither source has a title', async () => {
      const page = makePage({ pageRow: { title: '' }, fetched: { error: 'HTTP 400' } });
      await expect(command.func(page, { 'job-url': JOB_URL }))
        .rejects.toThrow(/could not find a job title \(jobPostings API: HTTP 400\)/);
    });

    it('raises AuthRequiredError when the API rejects the session', async () => {
      const page = makePage({ fetched: { authRequired: true, error: 'HTTP 401' } });
      await expect(command.func(page, { 'job-url': JOB_URL })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('raises AuthRequiredError without a JSESSIONID cookie', async () => {
      const page = makePage({ cookies: [] });
      await expect(command.func(page, { 'job-url': JOB_URL })).rejects.toBeInstanceOf(AuthRequiredError);
    });
  });
});
