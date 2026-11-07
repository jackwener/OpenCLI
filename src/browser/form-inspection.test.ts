import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { getFormStateJs } from './dom-snapshot.js';

describe('form inspection in a real DOM', () => {
  it('reports requirements without events or secret values, including unusual labels', () => {
    const dom = new JSDOM(`<form id="contact" action="/send" method="post"><input type="hidden" name="action" value="secret-action"><input type="hidden" name="elements"><input type="hidden" name="method"><input type="hidden" name="name">
      <label for="a&quot;b">Business email</label><input id="a&quot;b" name="email" type="email" required value="bad">
      <input type="hidden" value="secret-token"><input type="password" value="secret-password">
      <fieldset disabled><input name="disabled" required></fieldset>
      <textarea name="message"></textarea>
      <select name="topic" multiple><option value="a" selected>A</option><option value="b" selected>B</option></select>
      <button>Send</button>
    </form><input name="outside" aria-required="true">`, { url: 'https://example.test/contact', runScripts: 'outside-only' });
    let events = 0;
    dom.window.document.addEventListener('invalid', () => events++, true);
    dom.window.document.querySelector('textarea')!.value = 'x'.repeat(250);
    const result: any = dom.window.eval(getFormStateJs());
    expect(result.forms[0]).toMatchObject({ id: 'contact', name: null, action: 'https://example.test/send', method: 'POST' });
    const fields = result.forms[0].fields;
    expect(fields.find((f: any) => f.name === 'email')).toMatchObject({ label: 'Business email', required: true, invalid: ['typeMismatch'] });
    expect(fields.find((f: any) => f.name === 'disabled')).toMatchObject({ disabled: true, willValidate: false, invalid: [] });
    expect(fields.find((f: any) => f.name === 'message')).toMatchObject({ valueLength: 250, valueTruncated: true });
    expect(fields.find((f: any) => f.name === 'topic').options.filter((o: any) => o.selected)).toHaveLength(2);
    expect(fields.find((f: any) => f.type === 'password')).toMatchObject({ value: '••••', valueLength: null });
    expect(fields).toHaveLength(5);
    expect(result.orphanFields[0].required).toBe(true);
    expect(JSON.stringify(result)).not.toContain('secret-');
    expect(events).toBe(0);
    dom.window.close();
  });
});
