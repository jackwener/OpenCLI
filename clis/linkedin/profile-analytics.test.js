import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './profile-analytics.js';

const {
  normalizeProfileAnalyticsUrl,
  parseMetric,
  parseDashboardMetrics,
  normalizeAnalytics,
} = await import('./profile-analytics.js').then((m) => m.__test__);

describe('linkedin profile-analytics adapter', () => {
  const command = getRegistry().get('linkedin/profile-analytics');

  it('registers command shape', () => {
    expect(command).toBeDefined();
    expect(command.strategy).toBe('cookie');
    expect(command.browser).toBe(true);
    expect(command.columns).toEqual([
      'profile_url',
      'profile_views',
      'post_impressions',
      'search_appearances',
      'followers',
      'connections',
      'raw_analytics',
    ]);
  });

  it('normalizes profile url default and explicit /in URL', () => {
    expect(normalizeProfileAnalyticsUrl(undefined)).toBe('https://www.linkedin.com/in/me/');
    expect(normalizeProfileAnalyticsUrl('https://www.linkedin.com/in/gauravsaxena1997/')).toBe('https://www.linkedin.com/in/gauravsaxena1997/');
  });

  it('rejects non-profile URLs', () => {
    expect(() => normalizeProfileAnalyticsUrl('https://www.linkedin.com/jobs/')).toThrow(CommandExecutionError);
  });

  it('parses compact dashboard metrics', () => {
    expect(parseMetric('1.2K')).toBe('1200');
    expect(parseDashboardMetrics('31 post impressions 23 search appearances 32 profile views 1,234 followers 500 connections'))
      .toEqual({
        profile_views: '32',
        post_impressions: '31',
        search_appearances: '23',
        followers: '1234',
        connections: '500',
      });
  });

  it('normalizes browser payload into columns', () => {
    expect(normalizeAnalytics({
      profile_url: 'https://www.linkedin.com/in/me/',
      raw_analytics: '31 post impressions | 23 search appearances | 32 profile views',
    })).toMatchObject({
      profile_views: '32',
      post_impressions: '31',
      search_appearances: '23',
    });
  });

  it('does not emit an all-empty analytics row', () => {
    expect(() => normalizeAnalytics({ profile_url: 'https://www.linkedin.com/in/me/', raw_analytics: '' }))
      .toThrow(EmptyResultError);
  });
});
