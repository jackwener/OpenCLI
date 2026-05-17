import { describe, expect, it } from 'vitest';
import './salesnav-search.js';

const { parseLimit, leadSearchUrl, profileUrlFromEntityUrn, parseLeads } = await import('./salesnav-search.js').then((m) => m.__test__);

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

  it('validates --limit without silent clamping', () => {
    expect(parseLimit(undefined)).toBe(25);
    expect(parseLimit(120)).toBe(120);
    expect(() => parseLimit(0)).toThrow();
    expect(() => parseLimit(999)).toThrow();
    expect(() => parseLimit('abc')).toThrow();
  });

  it('parses lead rows, falls back to past positions, skips nameless entries', () => {
    const json = { elements: [
      { fullName: 'Jane Q', geoRegion: 'Vancouver, BC', degree: 2,
        entityUrn: 'urn:li:fs_salesProfile:(TOKEN1,NAME_SEARCH,abc)',
        currentPositions: [{ title: 'QA Manager', companyName: 'Acme Foods' }] },
      { fullName: 'No Current', geoRegion: 'Toronto',
        entityUrn: 'urn:li:fs_salesProfile:(TOKEN2,NAME_SEARCH,def)',
        currentPositions: [], pastPositions: [{ title: 'Past QA Lead', companyName: 'Old Co' }] },
      { firstName: '', lastName: '', entityUrn: 'urn:li:fs_salesProfile:(TOKEN3,x,y)' },
    ] };
    const leads = parseLeads(json);
    expect(leads).toHaveLength(2);
    expect(leads[0]).toMatchObject({ name: 'Jane Q', title: 'QA Manager', company: 'Acme Foods', location: 'Vancouver, BC', profile_url: 'https://www.linkedin.com/in/TOKEN1' });
    expect(leads[1]).toMatchObject({ name: 'No Current', title: 'Past QA Lead', company: 'Old Co' });
  });
});
