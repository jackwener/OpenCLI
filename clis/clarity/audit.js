import { cli, Strategy } from '@jackwener/opencli/registry';
import { discoverProjects, gotoClaritySettings, normalizeProjectId, readIntegrationCards } from './_ui.js';

const DEFAULT_REQUIRED = 'Google Analytics,Google Tag Manager';

export function statusOf(cards, name) {
  const hit = cards.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (hit) return hit.status;
  // The panel finished painting and this card was not on it — Clarity does not
  // offer that integration for this project. That is a third state: it is not
  // "Not Connected" (nothing to connect) and not "Unknown" (we did read it).
  return 'Not offered';
}

export const auditCommand = cli({
  site: 'clarity',
  name: 'audit',
  access: 'read',
  description: 'Check Google Analytics / Google Tag Manager (and Ads) integration status across every Clarity project, and flag the ones that still need setting up. Read-only.',
  example: 'opencli clarity audit -f table',
  domain: 'clarity.microsoft.com',
  strategy: Strategy.UI,
  browser: true,
  siteSession: 'ephemeral',
  navigateBefore: false,
  args: [
    { name: 'project-ids', type: 'string', required: false, help: 'Comma-separated project ids to check. Omit to auto-discover every project on the account.' },
    { name: 'required', type: 'string', required: false, default: DEFAULT_REQUIRED, help: `Comma-separated integrations that must be Connected. Default: ${DEFAULT_REQUIRED}` },
    { name: 'only-issues', type: 'boolean', required: false, default: false, help: 'Return only projects whose verdict is not ok.' },
  ],
  columns: ['ProjectId', 'Name', 'GoogleAnalytics', 'GoogleTagManager', 'GoogleAds', 'MicrosoftAds', 'Verdict'],
  func: async (page, kwargs) => {
    const required = String(kwargs.required || DEFAULT_REQUIRED)
      .split(',').map((s) => s.trim()).filter(Boolean);

    let targets;
    const explicit = String(kwargs['project-ids'] || '').trim();
    if (explicit) {
      targets = explicit.split(',').map((s) => ({ ProjectId: normalizeProjectId(s.trim()), Name: '' }));
    } else {
      targets = await discoverProjects(page);
    }

    const rows = [];
    for (const target of targets) {
      const projectId = target.ProjectId;
      let cards = null;
      let readError = '';
      // Retry once: a partial render is transient, and the card guard turns it
      // into a refusal rather than a wrong status — so a second look is cheap
      // and converts most would-be `unknown` rows into real readings.
      for (let attempt = 0; attempt < 2 && !cards; attempt += 1) {
        try {
          await gotoClaritySettings(page, projectId, 'setup', 'Clarity audit');
          cards = await readIntegrationCards(page);
          readError = '';
        } catch (error) {
          readError = String(error && error.message ? error.message : error).slice(0, 300);
        }
      }

      const ga  = cards ? statusOf(cards, 'Google Analytics')    : 'Unknown';
      const gtm = cards ? statusOf(cards, 'Google Tag Manager')  : 'Unknown';
      const gad = cards ? statusOf(cards, 'Google Ads')          : 'Unknown';
      const mad = cards ? statusOf(cards, 'Microsoft Ads')       : 'Unknown';

      const byName = { 'Google Analytics': ga, 'Google Tag Manager': gtm, 'Google Ads': gad, 'Microsoft Ads': mad };
      const missing = required.filter((r) => /^not connected$/i.test(byName[r] || ''));
      const notOffered = required.filter((r) => /^not offered$/i.test(byName[r] || ''));
      const unknown = required.filter((r) => !byName[r] || /^unknown$/i.test(byName[r]));

      let verdict;
      if (readError.startsWith('NOT_INSTALLED:')) verdict = 'not installed: Clarity has never received data from this site';
      else if (readError) verdict = `unknown: ${readError}`;
      else if (missing.length) verdict = `setup needed: ${missing.join(' + ')}`;
      else if (unknown.length) verdict = `unknown: ${unknown.join(' + ')} not readable`;
      else if (notOffered.length) verdict = `ok (${notOffered.join(' + ')} not offered for this project)`;
      else verdict = 'ok';

      rows.push({
        ProjectId: projectId,
        Name: target.Name || '',
        GoogleAnalytics: ga,
        GoogleTagManager: gtm,
        GoogleAds: gad,
        MicrosoftAds: mad,
        Verdict: verdict,
      });
    }

    // A "not signed in" reading is only credible if nothing else read either.
    // When other projects in the same run succeeded, the session is fine and
    // this project simply is not available to the account — a different fact,
    // with a different fix (regain access, not sign in).
    const anySucceeded = rows.some((r) => r.Verdict.startsWith('ok') || r.Verdict.startsWith('setup'));
    if (anySucceeded) {
      for (const row of rows) {
        if (/not signed in/i.test(row.Verdict)) {
          row.Verdict = 'no access: Clarity served its signed-out shell for this project while other projects in the same run read fine — the account likely cannot open it';
        }
      }
    }

    return kwargs['only-issues'] === true ? rows.filter((r) => !r.Verdict.startsWith('ok')) : rows;
  },
});
