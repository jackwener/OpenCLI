import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import {
  assertLinkedInAuthenticated,
  normalizeWhitespace,
  unwrapEvaluateResult,
} from './shared.js';

const PREFERENCES_URL = 'https://www.linkedin.com/jobs/preferences/';
const ALERTS_URL = 'https://www.linkedin.com/jobs/alerts/';

function inferOpenToWork(text) {
  const normalized = normalizeWhitespace(text).toLowerCase();
  if (/\bopen to work\b.{0,80}\b(on|status on|visible to recruiters|job preferences visible)\b/.test(normalized)) return 'on';
  if (/\bopen to work\b.{0,80}\b(off|status off|not visible|turned off|inactive)\b/.test(normalized)) return 'off';
  if (/\bopen to work\b/.test(normalized) && /\b(off|not visible|turned off|inactive)\b/.test(normalized)) return 'off';
  if (/\bopen to work\b/.test(normalized) && /\b(on|visible|actively|turned on)\b/.test(normalized)) return 'on';
  if (/\bopen to work\b/.test(normalized)) return 'visible';
  return 'unknown';
}

function buildPreferencesScript() {
  return String.raw`(() => {
    const clean = (s) => String(s || '').replace(/[\u00a0\u202f]+/g, ' ').replace(/\s+/g, ' ').trim();
    const text = document.body ? document.body.innerText || '' : '';
    const preferencesText = text.split(/Top job picks for you|Recommended jobs|Similar jobs|Explore jobs/i)[0] || text;
    const lines = preferencesText.split(/\n+/).map(clean).filter(Boolean);
    const jobTitles = [];
    const locations = [];
    for (const line of lines) {
      if (/senior|engineer|developer|architect|manager|designer|analyst|product/i.test(line) && line.length < 90) jobTitles.push(line);
      if (/(remote|india|bangalore|bengaluru|delhi|mumbai|hyderabad|pune|jaipur|within\s+\d+\s+miles?)/i.test(line) && line.length < 120) locations.push(line);
    }
    return {
      preferences_url: location.href,
      raw_preferences: clean(text).slice(0, 3000),
      job_titles: Array.from(new Set(jobTitles)).slice(0, 12),
      locations: Array.from(new Set(locations)).slice(0, 12),
    };
  })()`;
}

function buildAlertsScript() {
  return String.raw`(() => {
    const clean = (s) => String(s || '').replace(/[\u00a0\u202f]+/g, ' ').replace(/\s+/g, ' ').trim();
    const text = document.body ? document.body.innerText || '' : '';
    const lines = text.split(/\n+/).map(clean).filter(Boolean);
    const alerts = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/alert/i.test(line) && line.length < 160) {
        alerts.push([line, lines[i + 1], lines[i + 2]].filter(Boolean).join(' | '));
      }
    }
    return {
      alerts_url: location.href,
      job_alerts: Array.from(new Set(alerts)).slice(0, 20),
      raw_preferences: clean(text).slice(0, 3000),
    };
  })()`;
}

function normalizePreferences(preferences, alerts) {
  if (!preferences || typeof preferences !== 'object') {
    throw new CommandExecutionError('LinkedIn jobs preferences returned malformed preferences payload');
  }
  if (!alerts || typeof alerts !== 'object') {
    throw new CommandExecutionError('LinkedIn jobs preferences returned malformed alerts payload');
  }
  const preferenceText = normalizeWhitespace(preferences.raw_preferences);
  const alertText = normalizeWhitespace(alerts.raw_preferences);
  if (!preferenceText && !alertText) {
    throw new CommandExecutionError('LinkedIn jobs preferences could not find stable preferences content');
  }
  return {
    open_to_work: inferOpenToWork(`${preferenceText} ${alertText}`),
    job_titles: Array.isArray(preferences.job_titles) ? preferences.job_titles.map(normalizeWhitespace).filter(Boolean).join('; ') : '',
    locations: Array.isArray(preferences.locations) ? preferences.locations.map(normalizeWhitespace).filter(Boolean).join('; ') : '',
    job_alerts: Array.isArray(alerts.job_alerts) ? alerts.job_alerts.map(normalizeWhitespace).filter(Boolean).join('; ') : '',
    preferences_url: normalizeWhitespace(preferences.preferences_url),
    alerts_url: normalizeWhitespace(alerts.alerts_url),
    raw_preferences: preferenceText.slice(0, 1200),
  };
}

cli({
  site: 'linkedin',
  name: 'jobs-preferences',
  access: 'read',
  description: 'Read visible LinkedIn Jobs preferences and alert settings without changing them',
  domain: 'www.linkedin.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [],
  columns: ['open_to_work', 'job_titles', 'locations', 'job_alerts', 'preferences_url', 'alerts_url', 'raw_preferences'],
  func: async (page) => {
    if (!page) throw new CommandExecutionError('Browser session required for linkedin jobs-preferences');
    await page.goto(PREFERENCES_URL);
    await page.wait(5);
    await assertLinkedInAuthenticated(page, 'LinkedIn jobs-preferences');
    const preferences = unwrapEvaluateResult(await page.evaluate(buildPreferencesScript()));
    await page.goto(ALERTS_URL);
    await page.wait(5);
    await assertLinkedInAuthenticated(page, 'LinkedIn jobs-preferences alerts');
    const alerts = unwrapEvaluateResult(await page.evaluate(buildAlertsScript()));
    return [normalizePreferences(preferences, alerts)];
  },
});

export const __test__ = {
  inferOpenToWork,
  normalizePreferences,
};
