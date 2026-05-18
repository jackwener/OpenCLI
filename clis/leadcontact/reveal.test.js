import { describe, expect, it } from 'vitest';
import './reveal.js';

const {
  normalizeWhitespace,
  normalizeLinkedInUrl,
  buildLeadIdentity,
  extractEmails,
  extractPhones,
  classifyPhoneType,
  statusFromContacts,
  parseRevealText,
  leadContactAutomationScript,
} = await import('./reveal.js').then((m) => m.__test__);

describe('leadcontact reveal command', () => {
  it('normalizes whitespace and LinkedIn profile URLs', () => {
    expect(normalizeWhitespace(' Jane\u00a0 Q.   Smith ')).toBe('Jane Q. Smith');
    expect(normalizeLinkedInUrl('linkedin.com/in/jane-smith/')).toBe('https://www.linkedin.com/in/jane-smith/');
    expect(normalizeLinkedInUrl('https://ca.linkedin.com/in/jane-smith?trk=public_profile')).toBe('https://www.linkedin.com/in/jane-smith');
    expect(normalizeLinkedInUrl('https://www.linkedin.com/sales/lead/abc,NAME_SEARCH,tok')).toBe('https://www.linkedin.com/sales/lead/abc,NAME_SEARCH,tok');
    expect(() => normalizeLinkedInUrl('https://evil.example/in/jane')).toThrow();
  });

  it('requires either a LinkedIn URL or a name plus company identity', () => {
    expect(buildLeadIdentity({ linkedin: 'linkedin.com/in/jane-smith/' })).toMatchObject({
      mode: 'linkedin',
      linkedin_url: 'https://www.linkedin.com/in/jane-smith/',
    });
    expect(buildLeadIdentity({ name: 'Jane Smith', company: 'Acme Foods' })).toMatchObject({
      mode: 'name_company',
      name: 'Jane Smith',
      company: 'Acme Foods',
    });
    expect(() => buildLeadIdentity({ name: 'Jane Smith' })).toThrow();
    expect(() => buildLeadIdentity({ company: 'Acme Foods' })).toThrow();
  });

  it('extracts emails and phones from revealed LeadContact text without duplicates', () => {
    const text = `Jane Smith\nQA Manager\njane.smith@acmefoods.com\nDirect Phone\n+1 (604) 555-1212\nMobile\n604-555-1212\nOther jane.smith@acmefoods.com`;
    expect(extractEmails(text)).toEqual(['jane.smith@acmefoods.com']);
    expect(extractPhones(text)).toEqual(['+1 (604) 555-1212', '604-555-1212']);
  });

  it('keeps masked LeadContact phones and classifies phone types conservatively', () => {
    expect(extractPhones('Mobile +1 604***1212 Office 1-800-555-0200')).toEqual(['+1 604***1212', '1-800-555-0200']);
    expect(classifyPhoneType('+1 604***1212')).toBe('masked');
    expect(classifyPhoneType('1-800-555-0200')).toBe('company line');
    expect(classifyPhoneType('+1 (604) 555-1212')).toBe('unknown');
  });

  it('derives statuses and parsed contact rows', () => {
    expect(statusFromContacts(['j@x.com'], ['604-555-1212'])).toBe('email_phone_found');
    expect(statusFromContacts(['j@x.com'], [])).toBe('email_found');
    expect(statusFromContacts([], ['604-555-1212'])).toBe('phone_found');
    expect(statusFromContacts([], [])).toBe('no_contact_found');

    const parsed = parseRevealText('Jane Smith\nAcme Foods\njane@acmefoods.com\n+1 (604) 555-1212', { name: 'Jane Smith', company: 'Acme Foods', linkedin_url: 'https://www.linkedin.com/in/jane-smith/' });
    expect(parsed).toMatchObject({
      name: 'Jane Smith',
      company: 'Acme Foods',
      linkedin_url: 'https://www.linkedin.com/in/jane-smith/',
      emails: 'jane@acmefoods.com',
      phones: '+1 (604) 555-1212',
      status: 'email_phone_found',
      leadcontact_found: true,
    });
  });

  it('generates guarded UI automation for exact host, failed filters, and ambiguous reveals', () => {
    const script = leadContactAutomationScript({ mode: 'linkedin', linkedin_url: 'https://www.linkedin.com/in/jane-smith/' });
    expect(script).toContain("location.hostname !== 'app.leadcontact.ai'");
    expect(script).toContain('LeadContact filter action failed');
    expect(script).toContain('Multiple matching LeadContact result containers found');
    expect(script).toContain('Matched LeadContact result container became unreadable');
    expect(script).toContain('https://www.linkedin.com/in/jane-smith/');
  });
});
