import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import './job-detail.js';

const {
  normalizeJobUrl,
  normalizePublicJobUrl,
  decodeLinkedinRedirect,
  extractPublicDescriptionFromHtml,
  normalizeDetail,
} = await import('./job-detail.js').then((m) => m.__test__);

describe('linkedin job-detail adapter', () => {
  const command = getRegistry().get('linkedin/job-detail');

  it('registers command shape', () => {
    expect(command).toBeDefined();
    expect(command.strategy).toBe('cookie');
    expect(command.browser).toBe(true);
    expect(command.columns).toContain('description');
  });

  it('normalizes exact LinkedIn job urls', () => {
    expect(normalizeJobUrl('https://www.linkedin.com/jobs/view/123456?x=1')).toBe('https://www.linkedin.com/jobs/search/?currentJobId=123456');
  });

  it('normalizes public LinkedIn job urls', () => {
    expect(normalizePublicJobUrl('https://www.linkedin.com/jobs/view/123456?x=1')).toBe('https://www.linkedin.com/jobs/view/123456');
    expect(normalizePublicJobUrl('https://www.linkedin.com/jobs/view/senior-engineer-at-acme-123456')).toBe('https://www.linkedin.com/jobs/view/123456');
    expect(normalizePublicJobUrl('https://www.linkedin.com/jobs/search/?currentJobId=123456')).toBe('https://www.linkedin.com/jobs/view/123456');
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

  it('extracts public job descriptions from LinkedIn HTML', () => {
    expect(extractPublicDescriptionFromHtml(`
      <html><body>
        <div>Report this job</div>
        <p>We're looking for Next.js Developers.</p>
        <ul><li>Build web applications using Next.js and React.</li></ul>
        <h3>Seniority level</h3>
      </body></html>
    `)).toBe("We're looking for Next.js Developers. Build web applications using Next.js and React.");
    expect(extractPublicDescriptionFromHtml(`
      <script type="application/ld+json">{"description":"<p>Design and build coding benchmarks for AI models.</p>"}</script>
    `)).toBe('Design and build coding benchmarks for AI models.');
  });

  it('requires stable title in extracted detail', () => {
    expect(() => normalizeDetail({ title: '' })).toThrow(CommandExecutionError);
    expect(normalizeDetail({ title: 'Senior Engineer', company: 'Acme', description: 'Build things' }))
      .toMatchObject({ title: 'Senior Engineer', company: 'Acme', description: 'Build things' });
  });
});
