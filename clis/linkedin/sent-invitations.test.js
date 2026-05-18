import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { getRegistry } from '@jackwener/opencli/registry';
import './sent-invitations.js';

const { buildSentInvitationsScript } = await import('./sent-invitations.js').then((m) => m.__test__);

describe('linkedin sent-invitations command', () => {
  it('registers with structured columns that do not include raw blobs', () => {
    const command = getRegistry().get('linkedin/sent-invitations');
    expect(command).toBeDefined();
    expect(command.access).toBe('read');
    expect(command.columns).toEqual(['rank', 'name', 'profile_url', 'invited_date_text']);
  });

  it('extracts clean names and dedupes invitation cards by profile url', () => {
    const dom = new JSDOM(`<!doctype html><body>
      <ul>
        <li>
          <a href="/in/olga-magere/?miniProfileUrn=x"><span>Olga Magere</span></a>
          <span>Pending</span><button>Withdraw</button><span>Sent 2 weeks ago</span>
        </li>
        <li>
          <a href="/in/olga-magere/?trk=dup"><span>Olga Magere</span></a>
          <span>Pending</span><button>Withdraw</button><span>Sent 2 weeks ago</span>
        </li>
        <li>
          <div>Sam Founder\nSent yesterday\nWithdraw</div>
        </li>
      </ul>
    </body>`, { url: 'https://www.linkedin.com/mynetwork/invitation-manager/sent/' });
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const previousLocation = globalThis.location;
    try {
      globalThis.window = dom.window;
      globalThis.document = dom.window.document;
      globalThis.location = dom.window.location;
      globalThis.getComputedStyle = dom.window.getComputedStyle;
      Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetParent', { get() { return dom.window.document.body; }, configurable: true });
      const run = Function(`return ${buildSentInvitationsScript()}`);
      const result = run();
      expect(result.rows).toEqual([
        {
          name: 'Olga Magere',
          profile_url: 'https://www.linkedin.com/in/olga-magere/',
          invited_date_text: 'Sent 2 weeks ago',
        },
        {
          name: 'Sam Founder',
          profile_url: '',
          invited_date_text: 'Sent yesterday',
        },
      ]);
      expect(result.rows[0]).not.toHaveProperty('raw');
    } finally {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
      globalThis.location = previousLocation;
    }
  });
});
