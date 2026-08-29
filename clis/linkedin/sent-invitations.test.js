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

  it('scopes extraction to semantic invitation rows and ignores navigation labels', () => {
    const dom = new JSDOM(`<!doctype html><body>
      <header>
        <a href="/in/olga-magere/">0 notifications</a>
        <a href="/in/olga-magere/">Home</a>
        <button>Withdraw</button>
      </header>
      <ul>
        <li role="listitem">
          <a href="/in/olga-magere/?miniProfileUrn=x"><span aria-label="Olga Magere's profile picture"></span></a>
          <p>Olga Magere</p>
          <span>Pending</span>
          <button aria-label="Withdraw invitation sent to Olga Magere">Withdraw</button>
          <span>Sent 2 weeks ago</span>
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
      expect(result.candidateCount).toBe(1);
      expect(result.malformedCount).toBe(0);
      expect(result.rows).toEqual([
        {
          name: 'Olga Magere',
          profile_url: 'https://www.linkedin.com/in/olga-magere/',
          invited_date_text: 'Sent 2 weeks ago',
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
