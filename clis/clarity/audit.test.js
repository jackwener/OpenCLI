import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { statusOf } from './audit.js';
import { detailFor, normalizeProjectId } from './_ui.js';
import './audit.js';
import './integrations.js';
import './projects.js';

describe('clarity adapter registration', () => {
  it('registers all three read-only commands against the Clarity host', () => {
    for (const name of ['audit', 'integrations', 'projects']) {
      const command = getRegistry().get(`clarity/${name}`);
      expect(command, `clarity/${name} should be registered`).toBeDefined();
      expect(command?.access).toBe('read');
      expect(command?.domain).toBe('clarity.microsoft.com');
      expect(command?.browser).toBe(true);
      // Clarity's settings pages render blank in a reused context whose
      // document.title is the signed-out marketing page, so every command
      // must take a fresh one.
      expect(command?.siteSession).toBe('ephemeral');
    }
  });

  it('declares audit columns matching the keys its func returns', () => {
    expect(getRegistry().get('clarity/audit')?.columns).toEqual([
      'ProjectId', 'Name', 'GoogleAnalytics', 'GoogleTagManager',
      'GoogleAds', 'MicrosoftAds', 'Verdict',
    ]);
  });
});

describe('statusOf keeps the four states distinct', () => {
  const cards = [
    { name: 'Google Analytics', status: 'Connected' },
    { name: 'Google Ads', status: 'Not Connected' },
  ];

  it('reports the status a rendered card carried', () => {
    expect(statusOf(cards, 'Google Analytics')).toBe('Connected');
    expect(statusOf(cards, 'Google Ads')).toBe('Not Connected');
  });

  it('matches a card name case-insensitively', () => {
    expect(statusOf(cards, 'google analytics')).toBe('Connected');
  });

  // The whole point of the third state. A card Clarity never offers for a
  // project must not read as one the user declined to connect — collapsing
  // them sends someone to reconnect an integration that does not exist.
  it('reports an absent card as Not offered, never as Not Connected', () => {
    const absent = statusOf(cards, 'Google Tag Manager');
    expect(absent).toBe('Not offered');
    expect(absent).not.toBe('Not Connected');
  });
});

describe('normalizeProjectId refuses anything that is not an id', () => {
  it('accepts a Clarity project id', () => {
    expect(normalizeProjectId('a1b2c3d4e5')).toBe('a1b2c3d4e5');
    expect(normalizeProjectId('  a1b2c3d4e5  ')).toBe('a1b2c3d4e5');
  });

  // A bad id would otherwise be pasted into a URL and navigated to, and
  // Clarity answers an unknown project with a redirect that reads like a
  // signed-out page.
  it('rejects punctuation, paths and empties rather than navigating to them', () => {
    for (const bad of ['', '   ', 'not/an/id', 'abc', 'a1b2c3d4e5!', '../../etc']) {
      expect(() => normalizeProjectId(bad), `should reject ${JSON.stringify(bad)}`).toThrow();
    }
  });

  it('returns undefined for an optional id that was not supplied', () => {
    expect(normalizeProjectId('', { required: false })).toBeUndefined();
    expect(normalizeProjectId(undefined, { required: false })).toBeUndefined();
  });
});

describe('detailFor', () => {
  it('prefers the GTM account/container pair', () => {
    expect(detailFor({ account: '123', container: 'GTM-XXXX' })).toBe('account=123 container=GTM-XXXX');
  });

  it('falls back to the connected URL, and to empty when there is nothing', () => {
    expect(detailFor({ connectedTo: 'https://example.com' })).toBe('url=https://example.com');
    expect(detailFor({})).toBe('');
  });
});
