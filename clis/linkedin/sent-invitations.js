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
    const clean = (s) => String(s || '').replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
    const text = document.body ? (document.body.innerText || '') : '';
    const href = location.href;
    const authRequired = /\b(sign in|log in|join linkedin)\b/i.test(text)
      || /linkedin\.com\/(login|checkpoint|authwall|uas)/i.test(href);
    const warning = /captcha|verification required|unusual activity|account restricted|temporarily restricted|security check|checkpoint/i.test(text);
    const cards = Array.from(document.querySelectorAll('li, div, section, article')).filter((el) => {
      if (!el || el.offsetParent === null) return false;
      const t = clean(el.innerText || el.textContent || '');
      return t && /withdraw|pending|sent/i.test(t) && t.length < 1200;
    });
    const rows = [];
    const seen = new Set();
    for (const card of cards) {
      const raw = clean(card.innerText || card.textContent || '');
      if (!raw) continue;
      const link = Array.from(card.querySelectorAll('a[href*="/in/"]')).find((a) => clean(a.innerText || a.textContent || a.getAttribute('aria-label')));
      const linkText = clean(link?.innerText || link?.textContent || link?.getAttribute('aria-label') || '');
      const lines = raw.split(/\n+/).map(clean).filter(Boolean);
      const cleanName = (value) => {
        const line = clean(value).split(/\n+/).map(clean).filter(Boolean)[0] || '';
        return clean(line
          .replace(/^(view\s+)?profile\s+of\s+/i, '')
          .replace(/\s*(?:View profile|LinkedIn|Pending|Sent|Withdraw).*$/i, ''));
      };
      let name = cleanName(linkText)
        || cleanName(lines.find((line) => !/^(pending|sent|withdraw|message|view profile|invitation|invited|ago|manage)/i.test(line)) || '');
      const hrefAttr = link ? (link.getAttribute('href') || '') : '';
      const profile_url = hrefAttr ? new URL(hrefAttr, location.origin).toString().replace(/[?#].*$/, '') : '';
      const dateLine = lines.find((line) => /sent|invited|ago|\b\d{4}\b|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(line)) || '';
      const invited_date_text = clean((dateLine.match(/(?:sent|invited)\s+(?:\d+\s+\w+\s+ago|yesterday|today|on\s+[^\n]+|[A-Z][a-z]{2,9}\s+\d{1,2},?\s+\d{4}|\d{4})/i) || [''])[0] || dateLine);
      const key = (profile_url || name).toLowerCase();
      if (name && !seen.has(key)) {
        seen.add(key);
        rows.push({ name, profile_url, invited_date_text });
      }
    }
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
    await page.wait(8);
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
