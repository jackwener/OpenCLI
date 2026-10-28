import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import {
  buildAuthProbeScript,
  canonicalizeLinkedInThreadUrl,
  decodeLinkedInSafetyUrl,
  looksLinkedInAuthWall,
  normalizeWhitespace,
  unwrapEvaluateResult,
} from './shared.js';

describe('linkedin shared helpers', () => {
  it('unwraps complete browser evaluate envelopes', () => {
    const data = { ok: true, rows: [1, 2] };
    expect(unwrapEvaluateResult({ session: 'site:linkedin:1', data })).toBe(data);
  });

  it('preserves non-envelope payload identity', () => {
    const raw = { data: { ok: true } };
    const sessionOnly = { session: 'site:linkedin:1' };
    expect(unwrapEvaluateResult(raw)).toBe(raw);
    expect(unwrapEvaluateResult(sessionOnly)).toBe(sessionOnly);
  });

  it('returns null and scalar evaluate payloads unchanged', () => {
    expect(unwrapEvaluateResult(null)).toBe(null);
    expect(unwrapEvaluateResult('text')).toBe('text');
    expect(unwrapEvaluateResult(42)).toBe(42);
  });

  it('normalizes empty and direct HTTP URLs', () => {
    expect(decodeLinkedInSafetyUrl('')).toBe('');
    expect(decodeLinkedInSafetyUrl(null)).toBe('');
    expect(decodeLinkedInSafetyUrl(' https://example.com/demo ')).toBe('https://example.com/demo');
  });

  it('decodes LinkedIn safety redirect URLs', () => {
    expect(decodeLinkedInSafetyUrl('https://www.linkedin.com/safety/go/?url=https%3A%2F%2Fgithub.com%2Fjackwener%2FOpenCLI&urlhash=x'))
      .toBe('https://github.com/jackwener/OpenCLI');
  });

  it('rejects unsafe safety redirect targets', () => {
    expect(decodeLinkedInSafetyUrl('https://www.linkedin.com/safety/go/?url=javascript%3Aalert(1)&urlhash=x'))
      .toBe('');
    expect(decodeLinkedInSafetyUrl('javascript:alert(1)')).toBe('');
    expect(decodeLinkedInSafetyUrl('https://user:pass@example.com/demo')).toBe('');
  });

  it('normalizes LinkedIn messaging whitespace', () => {
    expect(normalizeWhitespace('  Lokesh\n\tRamesh  ')).toBe('Lokesh Ramesh');
    expect(normalizeWhitespace('A\u00a0\u202fB')).toBe('A B');
  });

  it('canonicalizes LinkedIn messaging thread URLs', () => {
    expect(canonicalizeLinkedInThreadUrl('https://www.linkedin.com/messaging/thread/abc/?foo=1#bar'))
      .toBe('https://www.linkedin.com/messaging/thread/abc/');
    expect(canonicalizeLinkedInThreadUrl('https://www.linkedin.com/messaging/thread/2-abc==/?mini=true#x'))
      .toBe('https://www.linkedin.com/messaging/thread/2-abc==/');
    expect(canonicalizeLinkedInThreadUrl('https://www.linkedin.com/messaging/thread/abc/extra')).toBe('');
    expect(canonicalizeLinkedInThreadUrl('https://evil-linkedin.com/messaging/thread/abc/')).toBe('');
    expect(canonicalizeLinkedInThreadUrl('http://www.linkedin.com/messaging/thread/abc/')).toBe('');
    expect(canonicalizeLinkedInThreadUrl('https://user:pass@www.linkedin.com/messaging/thread/abc/')).toBe('');
    expect(canonicalizeLinkedInThreadUrl('https://www.linkedin.com:444/messaging/thread/abc/')).toBe('');
  });

  it('detects LinkedIn auth-wall URLs and text branches', () => {
    expect(looksLinkedInAuthWall('https://www.linkedin.com/authwall Sign in to continue')).toBe(true);
    expect(looksLinkedInAuthWall('https://www.linkedin.com/checkpoint/challenge security verification required')).toBe(true);
    expect(looksLinkedInAuthWall('https://www.linkedin.com/feed/')).toBe(false);
    expect(looksLinkedInAuthWall('https://www.linkedin.com/login')).toBe(true);
    expect(looksLinkedInAuthWall('Please sign in to continue')).toBe(true);
    expect(looksLinkedInAuthWall('请登录后继续')).toBe(true);
  });
});

// Runs the real in-page auth check. jsdom has no innerText, so the page text is its textContent.
function authWallOn(html, url = 'https://www.linkedin.com/in/jane/') {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', {
    configurable: true,
    get() { return this.textContent; },
  });
  return dom.window.eval(buildAuthProbeScript());
}

const SIGNED_IN_NAV = `
  <header><nav>
    <a href="https://www.linkedin.com/feed/">Home</a>
    <a href="https://www.linkedin.com/messaging/?">Messaging</a>
    <a href="https://www.linkedin.com/notifications/?">Notifications</a>
  </nav></header>`;

describe('linkedin in-page auth wall check', () => {
  it('trusts the signed-in nav over member text that says "log in"', () => {
    // 2026-09-26: a profile's own post, "👉 Log in to https://exoc.ad/...", made the connect
    // probe call a signed-in page an auth wall and hard-stopped the day's invitations.
    expect(authWallOn(`${SIGNED_IN_NAV}<main><h1>Seth Potter</h1>
      <p>👉 Log in to https://exoc.ad/x and sign in to claim it. Insurance verification required. No captcha.</p></main>`)).toBe(false);
  });

  it('reads the page text only when no signed-in nav is present', () => {
    expect(authWallOn(`<main><h1>Jane Doe</h1>
      <a href="https://www.linkedin.com/login?session_redirect=%2Fmessaging%2F">Sign in</a>
      <a href="/signup/cold-join">Join now</a></main>`)).toBe(true);
    expect(authWallOn('<main><h1>Jane Doe</h1><p>Dentist in Vancouver</p></main>')).toBe(false);
    expect(authWallOn('<main><p>请登录后继续</p></main>')).toBe(true);
  });

  it('calls LinkedIn login, checkpoint and authwall routes walls whatever the page shows', () => {
    for (const url of [
      'https://www.linkedin.com/login',
      'https://www.linkedin.com/checkpoint/challenge/abc',
      'https://www.linkedin.com/authwall?trk=people_search',
      'https://www.linkedin.com/uas/login',
    ]) {
      expect(authWallOn(SIGNED_IN_NAV, url)).toBe(true);
    }
  });

  it('calls a login form or a captcha frame a wall even under the signed-in nav', () => {
    expect(authWallOn(`${SIGNED_IN_NAV}<form><input name="session_key"><input name="session_password" type="password"></form>`)).toBe(true);
    expect(authWallOn(`${SIGNED_IN_NAV}<iframe src="https://client-api.arkoselabs.com/fc/gc/"></iframe>`)).toBe(true);
    expect(authWallOn(`${SIGNED_IN_NAV}<iframe title="Security CAPTCHA" src="/x"></iframe>`)).toBe(true);
  });

  it('does not take an off-site link or a login redirect for the signed-in nav', () => {
    expect(authWallOn('<a href="https://evil-linkedin.com/messaging/">Messaging</a>\n<p>Sign in to continue</p>')).toBe(true);
    expect(authWallOn('<a href="https://www.linkedin.com/login?session_redirect=/messaging/">Messaging</a>\n<p>Sign in to continue</p>')).toBe(true);
  });

  it('is the only page-text auth check among the LinkedIn adapters', () => {
    // Six drifting copies of the old text regex are how one post stopped a whole day.
    const dir = dirname(fileURLToPath(import.meta.url));
    const copies = readdirSync(dir)
      .filter((file) => file.endsWith('.js') && !file.includes('.test.') && file !== 'shared.js')
      .filter((file) => /sign in\|log in/i.test(readFileSync(join(dir, file), 'utf8')));
    expect(copies).toEqual([]);
  });
});
