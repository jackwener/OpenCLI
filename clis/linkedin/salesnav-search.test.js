import { describe, expect, it } from 'vitest';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import './salesnav-search.js';

const {
  parseLimit,
  leadSearchUrl,
  profileUrlFromEntityUrn,
  leadUrlFromEntityUrn,
  parseLeads,
  requireLeadSearchResult,
} = await import('./salesnav-search.js').then((m) => m.__test__);

describe('linkedin salesnav-search command', () => {
  it('builds a salesApiLeadSearch URL with encoded keywords and pagination', () => {
    const url = leadSearchUrl('quality manager food', 50);
    expect(url).toContain('/sales-api/salesApiLeadSearch');
    expect(url).toContain('keywords:quality%20manager%20food');
    expect(url).toContain('start=50');
    expect(url).toContain('count=25');
  });

  it('derives a profile URL from the sales-profile entityUrn token', () => {
    expect(profileUrlFromEntityUrn('urn:li:fs_salesProfile:(ACwAAAJS8TABxyz,NAME_SEARCH,Enlo)'))
      .toBe('https://www.linkedin.com/in/ACwAAAJS8TABxyz');
    expect(profileUrlFromEntityUrn('')).toBe('');
    expect(profileUrlFromEntityUrn('not-a-urn')).toBe('');
  });

  it('derives a Sales Navigator lead URL from the full sales-profile entityUrn', () => {
    expect(leadUrlFromEntityUrn('urn:li:fs_salesProfile:(ACwAAAJS8TABxyz,NAME_SEARCH,Enlo)'))
      .toBe('https://www.linkedin.com/sales/lead/ACwAAAJS8TABxyz,NAME_SEARCH,Enlo');
    expect(leadUrlFromEntityUrn('not-a-urn')).toBe('');
  });

  it('validates --limit without silent clamping', () => {
    expect(parseLimit(undefined)).toBe(25);
    expect(parseLimit(120)).toBe(120);
    expect(() => parseLimit(0)).toThrow();
    expect(() => parseLimit(999)).toThrow();
    expect(() => parseLimit('abc')).toThrow();
  });

  it('parses lead rows and falls back to past positions', () => {
    const json = { elements: [
      { fullName: 'Jane Q', geoRegion: 'Vancouver, BC', degree: 2,
        entityUrn: 'urn:li:fs_salesProfile:(TOKEN1,NAME_SEARCH,abc)',
        currentPositions: [{ title: 'QA Manager', companyName: 'Acme Foods' }] },
      { fullName: 'No Current', geoRegion: 'Toronto',
        entityUrn: 'urn:li:fs_salesProfile:(TOKEN2,NAME_SEARCH,def)',
        currentPositions: [], pastPositions: [{ title: 'Past QA Lead', companyName: 'Old Co' }] },
    ] };
    const leads = parseLeads(json);
    expect(leads).toHaveLength(2);
    expect(leads[0]).toMatchObject({
      name: 'Jane Q',
      title: 'QA Manager',
      company: 'Acme Foods',
      location: 'Vancouver, BC',
      profile_url: 'https://www.linkedin.com/in/TOKEN1',
      lead_url: 'https://www.linkedin.com/sales/lead/TOKEN1,NAME_SEARCH,abc',
      recipient_urn: 'urn:li:fs_salesProfile:(TOKEN1,NAME_SEARCH,abc)',
    });
    expect(leads[1]).toMatchObject({ name: 'No Current', title: 'Past QA Lead', company: 'Old Co' });
  });

  it('fails typed on malformed lead payloads instead of silently dropping rows', () => {
    expect(() => parseLeads({})).toThrow(CommandExecutionError);
    expect(() => parseLeads({ elements: [{ firstName: '', lastName: '', entityUrn: 'urn:li:fs_salesProfile:(TOKEN3,x,y)' }] }))
      .toThrow(CommandExecutionError);
    expect(() => parseLeads({ elements: [{ fullName: 'No Identity' }] }))
      .toThrow(CommandExecutionError);
    expect(() => requireLeadSearchResult({ error: 'HTTP 500' })).toThrow(CommandExecutionError);
    expect(() => requireLeadSearchResult({})).toThrow(CommandExecutionError);
  });
});
