import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

const LINKEDIN_DOMAIN = 'www.linkedin.com';
const SENT_URL = 'https://www.linkedin.com/mynetwork/invitation-manager/sent/';

function unwrapEvaluateResult(payload) {
  if (payload && typeof payload === 'object' && 'data' in payload && 'session' in payload) return payload.data;
  return payload;
}

function buildSentInvitationsScript() {
  return String.raw`(() => {
    const clean = (s) => String(s || '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
    const text = document.body ? (document.body.innerText || '') : '';
    const href = location.href;
    const authRequired = /\b(sign in|log in|join linkedin)\b/i.test(text)
      || /linkedin\.com\/(login|checkpoint|authwall|uas)/i.test(href);
    const warning = /captcha|verification required|unusual activity|account restricted|temporarily restricted|security check|checkpoint/i.test(text);
    const cleanName = (value) => {
      const first = String(value || '').split(/\n+/).map(clean).filter(Boolean)[0] || '';
      return clean(first
        .replace(/^(view\s+)?profile\s+of\s+/i, '')
        .replace(/\s*(?:View profile|LinkedIn|Pending|Sent|Withdraw).*$/i, ''));
    };
    const cards = Array.from(document.querySelectorAll('li, div, section, article')).filter((el) => {
      if (!el || el.offsetParent === null) return false;
      const t = clean(el.innerText || el.textContent || '');
      return t && /withdraw/i.test(t) && t.length < 1200;
    });
    const byName = new Map();
    for (const card of cards) {
      const raw = card.innerText || card.textContent || '';
      if (!/withdraw/i.test(raw)) continue;
      const lines = raw.split(/\n+/).map(clean).filter(Boolean);
      const link = card.querySelector('a[href*="/in/"]');
      const linkName = cleanName(link ? (link.innerText || link.textContent || link.getAttribute('aria-label') || '') : '');
      const name = linkName
        || cleanName(lines.find((line) => !/^(pending|sent|withdraw|message|view profile|invitation|invited|ago|manage|received)\b/i.test(line)) || '');
      if (!name) continue;
      const hrefAttr = link ? (link.getAttribute('href') || '') : '';
      const profile_url = hrefAttr ? new URL(hrefAttr, location.origin).toString().replace(/[?#].*$/, '') : '';
      const invited_date_text = clean((raw.match(/(?:Sent|Invited)\s+(?:\d+\s+\w+\s+ago|yesterday|today)/i) || [''])[0]);
      const key = name.toLowerCase();
      const existing = byName.get(key);
      if (!existing) {
        byName.set(key, { name, profile_url, invited_date_text });
      } else {
        if (!existing.profile_url && profile_url) existing.profile_url = profile_url;
        if (!existing.invited_date_text && invited_date_text) existing.invited_date_text = invited_date_text;
      }
    }
    const rows = Array.from(byName.values());
    return { url: href, title: document.title || '', authRequired, warning, count: rows.length, rows, bodyText: text.slice(0, 1000) };
  })()`;
}

cli({
  site: 'linkedin',
  name: 'sent-invitations',
  access: 'read',
  description: 'List pending LinkedIn sent invitations for CRM reconciliation',
  domain: LINKEDIN_DOMAIN,
  strategy: Strategy.UI,
  browser: true,
  args: [],
  columns: ['rank', 'name', 'profile_url', 'invited_date_text'],
  func: async (page) => {
    if (!page) throw new CommandExecutionError('Browser session required for linkedin sent-invitations');
    await page.goto(SENT_URL);
    await page.wait(12);
    let result = unwrapEvaluateResult(await page.evaluate(buildSentInvitationsScript()));
    if (result?.authRequired) {
      throw new AuthRequiredError(LINKEDIN_DOMAIN, 'LinkedIn sent invitations requires an active signed-in browser session.');
    }
    if (result?.warning) {
      throw new CommandExecutionError('LinkedIn warning/restriction state visible on sent invitations page.');
    }
    const rows = Array.isArray(result?.rows) ? result.rows : [];
    return rows.map((row, index) => ({
      rank: index + 1,
      name: row.name || '',
      profile_url: row.profile_url || '',
      invited_date_text: row.invited_date_text || '',
    }));
  },
});

export const __test__ = {
  buildSentInvitationsScript,
  unwrapEvaluateResult,
};
