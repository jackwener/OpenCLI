import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { unwrapEvaluateResult } from './shared.js';

const LINKEDIN_DOMAIN = 'www.linkedin.com';
const SENT_URL = 'https://www.linkedin.com/mynetwork/invitation-manager/sent/';

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
    const explicitEmpty = /(?:no|don't have any|haven't sent any)\s+(?:pending\s+)?(?:sent\s+)?invitations?/i.test(text)
      || /暂无(?:已发送|待处理)?邀请/.test(text);
    const cards = Array.from(document.querySelectorAll('[role="listitem"], li, article')).filter((el) => {
      if (!el || el.offsetParent === null) return false;
      const profileLink = el.querySelector('a[href*="/in/"]');
      const actions = Array.from(el.querySelectorAll('a, button'));
      const withdraw = actions.find((action) => {
        const label = clean(action.getAttribute('aria-label') || action.innerText || action.textContent || '');
        return /^withdraw(?:\s+invitation\s+sent\s+to\b|$)/i.test(label);
      });
      return Boolean(profileLink && withdraw);
    });
    const byProfile = new Map();
    let malformedCount = 0;
    for (const card of cards) {
      const raw = card.innerText || card.textContent || '';
      const lines = raw.split(/\n+/).map(clean).filter(Boolean);
      const link = card.querySelector('a[href*="/in/"]');
      const withdraw = Array.from(card.querySelectorAll('a, button')).find((action) => {
        const label = clean(action.getAttribute('aria-label') || action.innerText || action.textContent || '');
        return /^withdraw(?:\s+invitation\s+sent\s+to\b|$)/i.test(label);
      });
      const withdrawLabel = clean(withdraw ? (withdraw.getAttribute('aria-label') || '') : '');
      const actionName = cleanName((withdrawLabel.match(/^withdraw\s+invitation\s+sent\s+to\s+(.+)$/i) || [])[1] || '');
      const linkName = cleanName(link ? (link.innerText || link.textContent || link.getAttribute('aria-label') || '') : '');
      const name = actionName
        || linkName
        || cleanName(lines.find((line) => !/^(pending|sent|withdraw|message|view profile|invitation|invited|ago|manage|received)\b/i.test(line)) || '');
      const hrefAttr = link ? (link.getAttribute('href') || '') : '';
      const profile_url = hrefAttr ? new URL(hrefAttr, location.origin).toString().replace(/[?#].*$/, '') : '';
      const invited_date_text = clean((raw.match(/(?:Sent|Invited)\s+(?:\d+\s+\w+\s+ago|yesterday|today)/i) || [''])[0]);
      if (!name || !profile_url) {
        malformedCount += 1;
        continue;
      }
      const key = profile_url.toLowerCase();
      const existing = byProfile.get(key);
      if (!existing) {
        byProfile.set(key, { name, profile_url, invited_date_text });
      } else {
        if (!existing.invited_date_text && invited_date_text) existing.invited_date_text = invited_date_text;
      }
    }
    const rows = Array.from(byProfile.values());
    return {
      url: href,
      title: document.title || '',
      authRequired,
      warning,
      explicitEmpty,
      candidateCount: cards.length,
      malformedCount,
      count: rows.length,
      rows,
    };
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
    if (!result || typeof result !== 'object' || Array.isArray(result) || !Array.isArray(result.rows)) {
      throw new CommandExecutionError('LinkedIn sent invitations returned a malformed extraction payload.');
    }
    if (result.malformedCount > 0) {
      throw new CommandExecutionError('LinkedIn sent invitations contained a malformed invitation card.');
    }
    const rows = result.rows;
    if (rows.length === 0) {
      if (result.explicitEmpty) {
        throw new EmptyResultError('linkedin sent-invitations', 'No pending sent invitations were found.');
      }
      throw new CommandExecutionError('LinkedIn sent invitation cards were not found; the page structure may have changed.');
    }
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
};
