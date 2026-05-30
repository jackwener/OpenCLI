import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import './jobs-preferences.js';

const { inferOpenToWork, normalizePreferences } = await import('./jobs-preferences.js').then((m) => m.__test__);

describe('linkedin jobs-preferences adapter', () => {
  const command = getRegistry().get('linkedin/jobs-preferences');

  it('registers command shape', () => {
    expect(command).toBeDefined();
    expect(command.strategy).toBe('cookie');
    expect(command.browser).toBe(true);
    expect(command.columns).toContain('open_to_work');
  });

  it('infers Open to Work visible states conservatively', () => {
    expect(inferOpenToWork('Open to work turned off')).toBe('off');
    expect(inferOpenToWork('Open to work turned on visible to recruiters')).toBe('on');
    expect(inferOpenToWork('Open to work')).toBe('visible');
    expect(inferOpenToWork('Job preferences')).toBe('unknown');
  });

  it('normalizes preferences and alerts', () => {
    const out = normalizePreferences(
      { raw_preferences: 'Open to work turned off', job_titles: ['Senior Software Engineer'], locations: ['Bangalore within 20 miles'], preferences_url: 'https://www.linkedin.com/jobs/preferences/' },
      { raw_preferences: 'Job alert', job_alerts: ['Senior Software Engineer | Bangalore'], alerts_url: 'https://www.linkedin.com/jobs/alerts/' },
    );
    expect(out).toMatchObject({
      open_to_work: 'off',
      job_titles: 'Senior Software Engineer',
      locations: 'Bangalore within 20 miles',
      job_alerts: 'Senior Software Engineer | Bangalore',
    });
  });

  it('rejects malformed payloads', () => {
    expect(() => normalizePreferences(null, {})).toThrow(CommandExecutionError);
    expect(() => normalizePreferences({}, null)).toThrow(CommandExecutionError);
    expect(() => normalizePreferences({ raw_preferences: '' }, { raw_preferences: '' })).toThrow(CommandExecutionError);
  });
});
