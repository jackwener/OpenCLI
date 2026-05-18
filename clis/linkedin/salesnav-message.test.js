import { describe, expect, it } from 'vitest';
import './salesnav-message.js';

const {
  parseSalesProfileUrn,
  parseRecipient,
  salesLeadUrlFromParts,
  profileApiUrl,
  buildCreateMessagePayload,
  extractRemainingCredits,
  profileSummary,
  salesPageShowsSentMessage,
} = await import('./salesnav-message.js').then((m) => m.__test__);

describe('linkedin salesnav-message command', () => {
  it('parses Sales Navigator profile urns and lead URLs', () => {
    const urn = 'urn:li:fs_salesProfile:(ACwAAAJS8TABxyz,NAME_SEARCH,Enlo)';
    expect(parseSalesProfileUrn(urn)).toMatchObject({
      profileId: 'ACwAAAJS8TABxyz',
      authType: 'NAME_SEARCH',
      authToken: 'Enlo',
      entityUrn: urn,
    });
    expect(parseSalesProfileUrn('urn:li:fs_salesProfile:(ACwAAAJS8TABxyz,undefined,undefined)')).toBeNull();

    const parsed = parseRecipient('https://www.linkedin.com/sales/lead/ACwAAAJS8TABxyz,NAME_SEARCH,Enlo');
    expect(parsed).toMatchObject({ profileId: 'ACwAAAJS8TABxyz', authType: 'NAME_SEARCH', authToken: 'Enlo' });
    expect(parsed.entityUrn).toBe(urn);
    expect(salesLeadUrlFromParts(parsed)).toBe('https://www.linkedin.com/sales/lead/ACwAAAJS8TABxyz,NAME_SEARCH,Enlo');
  });

  it('accepts LinkedIn /in tokens as unresolved recipients', () => {
    expect(parseRecipient('https://www.linkedin.com/in/ACwAAAJS8TABxyz/')).toMatchObject({
      profileId: 'ACwAAAJS8TABxyz',
      authType: '',
      authToken: '',
      entityUrn: '',
    });
  });

  it('builds profile API URLs with the Sales Navigator auth key', () => {
    const url = profileApiUrl({ profileId: 'P1', authType: 'NAME_SEARCH', authToken: 'T1' });
    expect(url).toContain('/sales-api/salesApiProfiles/(profileId:P1,authType:NAME_SEARCH,authToken:T1)');
    expect(url).toContain('decoration=');
  });

  it('constructs the createMessage action payload used by Sales Navigator', () => {
    const payload = buildCreateMessagePayload({
      recipientUrn: 'urn:li:fs_salesProfile:(P1,NAME_SEARCH,T1)',
      subject: 'Quick QA doc question',
      body: 'Hi Jane, can I ask a quick question?',
      trackingId: '0123456789abcdef',
      copyToCrm: false,
    });
    expect(payload).toEqual({
      createMessageRequest: {
        recipients: ['urn:li:fs_salesProfile:(P1,NAME_SEARCH,T1)'],
        subject: 'Quick QA doc question',
        body: 'Hi Jane, can I ask a quick question?',
        copyToCrm: false,
        trackingId: '0123456789abcdef',
      },
    });
  });

  it('validates payload fields before any send attempt', () => {
    expect(() => buildCreateMessagePayload({ recipientUrn: '', subject: 's', body: 'b' })).toThrow();
    expect(() => buildCreateMessagePayload({ recipientUrn: 'urn:li:fs_salesProfile:(P,A,T)', subject: '', body: 'b' })).toThrow();
    expect(() => buildCreateMessagePayload({ recipientUrn: 'urn:li:fs_salesProfile:(P,A,T)', subject: 's', body: '' })).toThrow();
    expect(() => buildCreateMessagePayload({ recipientUrn: 'urn:li:fs_salesProfile:(P,A,T)', subject: 'x'.repeat(201), body: 'b' })).toThrow();
    expect(() => buildCreateMessagePayload({ recipientUrn: 'urn:li:fs_salesProfile:(P,undefined,undefined)', subject: 's', body: 'b' })).toThrow();
  });

  it('detects the Sales Navigator sent activity on a verified lead page', () => {
    expect(salesPageShowsSentMessage('5/18/2026 You sent a Sales Navigator message to Jane', 'Jane Q')).toBe(true);
    expect(salesPageShowsSentMessage('No recent activity', 'Jane Q')).toBe(false);
  });

  it('extracts a plausible remaining InMail credit count', () => {
    expect(extractRemainingCredits({ elements: [{ type: 'LSS_INMAIL', value: 149, id: 1 }], paging: { count: 10 } })).toBe(149);
    expect(extractRemainingCredits({ data: { remaining: 149, used: 1 } })).toBe(149);
    expect(extractRemainingCredits({ elements: [{ availableCount: 12 }] })).toBe(12);
    expect(extractRemainingCredits({})).toBe(null);
  });

  it('summarizes decorated Sales Navigator profile data', () => {
    expect(profileSummary({ data: {
      fullName: 'Rayki Goh',
      headline: 'Food Safety',
      degree: 3,
      defaultPosition: { title: 'FSQA Manager', companyName: 'Acme Foods' },
      memberBadges: { openLink: false },
    } })).toMatchObject({
      recipient: 'Rayki Goh',
      title: 'FSQA Manager',
      company: 'Acme Foods',
      degree: '3',
      open_link: false,
    });
  });
});
