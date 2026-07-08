import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import './services-read.js';

const {
  normalizeProfileUrl,
  normalizeServicesUrl,
  normalizeServices,
  pairsToMedia,
} = await import('./services-read.js').then((m) => m.__test__);

describe('linkedin services-read adapter', () => {
  const command = getRegistry().get('linkedin/services-read');

  it('registers command shape', () => {
    expect(command).toBeDefined();
    expect(command.strategy).toBe('cookie');
    expect(command.browser).toBe(true);
    expect(command.columns).toEqual([
      'service_url',
      'page_title',
      'overview',
      'availability',
      'work_locations',
      'pricing',
      'services_provided',
      'services_count',
      'media',
      'media_count',
      'messages',
      'reviews_visibility',
    ]);
  });

  it('normalizes profile and services URLs', () => {
    expect(normalizeProfileUrl(undefined)).toBe('https://www.linkedin.com/in/me/');
    expect(normalizeProfileUrl('https://www.linkedin.com/in/gauravsaxena1997/')).toBe('https://www.linkedin.com/in/gauravsaxena1997/');
    expect(normalizeServicesUrl('https://www.linkedin.com/services/page/854507342066b51989/')).toBe('https://www.linkedin.com/services/page/854507342066b51989/');
  });

  it('rejects invalid URL shapes', () => {
    expect(() => normalizeProfileUrl('https://www.linkedin.com/jobs/')).toThrow(CommandExecutionError);
    expect(() => normalizeServicesUrl('https://www.linkedin.com/in/gauravsaxena1997/')).toThrow(CommandExecutionError);
  });

  it('pairs media title and description lines', () => {
    expect(pairsToMedia(['Portfolio', 'Builds AI products', 'GitHub', 'Open source work']))
      .toEqual(['Portfolio — Builds AI products', 'GitHub — Open source work']);
  });

  it('normalizes services payload into command columns', () => {
    expect(normalizeServices({
      service_url: 'https://www.linkedin.com/services/page/abc/',
      page_title: 'Gaurav Services',
      overview: ' Builds AI ',
      availability: 'Remote',
      work_locations: ['Greater Jaipur Area', 'I am available to work remotely'],
      pricing: 'Pricing, Select one option, Contact for pricing, required',
      services_provided: ['Web Development', 'SaaS Development'],
      media_lines: ['Portfolio', 'AI products'],
      messages: 'on',
      reviews_visibility: 'off',
    })).toEqual({
      service_url: 'https://www.linkedin.com/services/page/abc/',
      page_title: 'Gaurav Services',
      overview: 'Builds AI',
      availability: 'Remote',
      work_locations: 'Greater Jaipur Area; I am available to work remotely',
      pricing: 'Contact for pricing',
      services_provided: 'Web Development; SaaS Development',
      services_count: '2',
      media: 'Portfolio — AI products',
      media_count: '1',
      messages: 'on',
      reviews_visibility: 'off',
    });
  });

  it('fails closed when a services page payload has no stable content', () => {
    expect(() => normalizeServices({ service_url: 'https://www.linkedin.com/services/page/abc/' }))
      .toThrow(CommandExecutionError);
    expect(() => normalizeServices({ page_title: 'Alice Services' }))
      .toThrow(CommandExecutionError);
  });

  it('does not require edit access when reading an explicit services URL', async () => {
    const page = {
      goto: vi.fn(async () => {}),
      wait: vi.fn(async () => {}),
      evaluate: vi.fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce({
          service_url: 'https://www.linkedin.com/services/page/abc/',
          page_title: 'Alice Services',
          overview: 'Builds AI',
          services_provided: ['AI Consulting'],
        }),
    };

    await expect(command.func(page, { 'services-url': 'https://www.linkedin.com/services/page/abc/' }))
      .resolves.toMatchObject([{ page_title: 'Alice Services', services_count: '1' }]);
    expect(page.goto.mock.calls.map(([url]) => String(url))).toEqual(['https://www.linkedin.com/services/page/abc/']);
  });
});
