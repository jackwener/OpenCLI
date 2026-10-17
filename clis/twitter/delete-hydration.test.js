import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { __test__ } from './delete.js';

it('waits for Delete when another menu item renders first', async () => {
  const dom = new JSDOM('<article><a href="https://x.com/alice/status/123">target</a><button data-testid="caret">More</button></article>', { url: 'https://x.com/alice/status/123', runScripts: 'outside-only' });
  const doc = dom.window.document;
  Object.defineProperty(dom.window.HTMLElement.prototype, 'getClientRects', { value: () => [{}] });
  let elapsed = 0;
  let deleted = false;
  dom.window.setTimeout = (handler, ms) => {
    elapsed += ms;
    if (elapsed >= 750 && !doc.querySelector('#delete')) {
      const item = doc.createElement('div'); item.id = 'delete'; item.setAttribute('role','menuitem'); item.textContent = 'Delete';
      item.onclick = () => { const confirm = doc.createElement('button'); confirm.setAttribute('data-testid','confirmationSheetConfirm'); confirm.onclick = () => { deleted = true; }; doc.body.append(confirm); };
      doc.body.append(item);
    }
    handler(); return 0;
  };
  doc.querySelector('[data-testid="caret"]').onclick = () => { const pin = doc.createElement('div'); pin.setAttribute('role','menuitem'); pin.textContent = 'Pin'; doc.body.append(pin); };
  const result = await dom.window.eval(__test__.buildDeleteScript('123'));
  expect({ result, deleted, elapsed }).toMatchObject({ result: { ok: true }, deleted: true });
});

import { getRegistry } from '@jackwener/opencli/registry';
import './block.js';
import './hide-reply.js';

it.each(['block', 'hide-reply'])('waits for a delayed %s row after unrelated menu items', async (command) => {
  const dom = new JSDOM('<main data-testid="primaryColumn"><article><a href="https://x.com/alice/status/123">target</a><button data-testid="userActions" aria-label="More">More</button></article></main>', { url: 'https://x.com/alice/status/123', runScripts: 'outside-only' });
  const doc = dom.window.document;
  Object.defineProperty(dom.window.HTMLElement.prototype, 'getClientRects', { value: () => [{}] });
  let elapsed = 0;
  let clicked = false;
  let opened = false;
  doc.querySelector('[aria-label="More"]').onclick = () => {
    opened = true;
    doc.body.insertAdjacentHTML('beforeend', '<div role="menuitem">Share</div>');
  };
  dom.window.setTimeout = (handler, ms) => {
    elapsed += ms;
    if (opened && elapsed >= 1000 && !doc.querySelector('#action')) {
      const item = doc.createElement('div'); item.id = 'action'; item.setAttribute('role', 'menuitem'); item.textContent = command === 'block' ? 'Block @alice' : 'Hide reply';
      item.onclick = () => {
        clicked = true;
        if (command === 'block') {
          const confirm = doc.createElement('button'); confirm.setAttribute('data-testid', 'confirmationSheetConfirm');
          confirm.onclick = () => doc.querySelector('main').insertAdjacentHTML('beforeend', '<button data-testid="alice-unblock">Blocked</button>');
          doc.body.append(confirm);
        }
      };
      doc.body.append(item);
    }
    handler(); return 0;
  };
  const page = { goto: async () => {}, wait: async () => {}, evaluate: async script => dom.window.eval(script) };
  const rows = await getRegistry().get(`twitter/${command}`).func(page, { username: 'alice', url: 'https://x.com/alice/status/123' });
  expect(clicked).toBe(true);
  expect(rows[0].status).toBe('success');
});
