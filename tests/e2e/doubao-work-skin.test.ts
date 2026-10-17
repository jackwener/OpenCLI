/**
 * Doubao Work-skin E2E — runs the real CLI against the real Doubao Work page.
 *
 * Gated behind OPENCLI_E2E=1 like the other live-site suites. Every command
 * touches ONLY the user's own conversation: a tagged self-message, read back,
 * plus read-only history/status. Never targets colleagues or groups.
 *
 * Non-TTY stdout makes the CLI emit JSON, so assert on parsed rows (-f json),
 * mirroring douban.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { parseJsonOutput, runCli } from './helpers.js';

// Unique per run so the content roundtrip assertion is unambiguous and the
// identical-text limitation never muddies the result.
const TAG = `【E2E自测 ${new Date().toISOString().slice(0, 16)}】自动化测试消息，无需回应。`;

function isEnvironmentSkip(text: string) {
  return /AUTH_REQUIRED|Browser Bridge.*not connected|Extension.*not connected|请先登录|登录已过期/i.test(text);
}

async function runDoubaoJsonOrSkip(args: string[], label: string, timeout = 120000) {
  const result = await runCli([...args, '-f', 'json'], { timeout });
  if (result.code !== 0) {
    if (isEnvironmentSkip(`${result.stderr}\n${result.stdout}`)) {
      console.warn(`${label}: skipped - doubao login or browser environment is unavailable`);
      return null;
    }
    throw new Error(`${label} failed:\n${result.stderr || result.stdout}`);
  }
  return parseJsonOutput(result.stdout) as Array<Record<string, unknown>>;
}

describe('doubao work-skin e2e (real account, self only)', () => {
  it('status: login resolved (fast path or probe)', async () => {
    const rows = await runDoubaoJsonOrSkip(['doubao', 'status'], 'doubao status');
    if (rows === null) return;
    // Work skin lacks chat_layout.userSetting, so the probe fallback may run;
    // either path must end at an explicit logged-in true — never Unknown.
    expect(String(rows[0].Login)).toMatch(/^(yes|true)$/i);
  }, 150000);

  it('send: self-message lands and read round-trips the content', async () => {
    const sent = await runDoubaoJsonOrSkip(['doubao', 'send', '--window', 'foreground', TAG], 'doubao send');
    if (sent === null) return;
    expect(sent[0].Status).toBe('Success');
    expect(sent[0].SubmittedBy).toBe('button');

    const read = await runDoubaoJsonOrSkip(['doubao', 'read'], 'doubao read');
    if (read === null) return;
    const squash = (value) => String(value).replace(/\s+/g, '');
    const userTexts = read.filter((row) => row.Role === 'User').map((row) => squash(row.Text));
    expect(userTexts.some((text) => text.includes(squash(TAG)))).toBe(true);
  }, 180000);

  it('history: sidebar extraction returns at least one conversation', async () => {
    const rows = await runDoubaoJsonOrSkip(['doubao', 'history', '--limit', '3'], 'doubao history');
    if (rows === null) return;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(String(rows[0].Id)).toMatch(/^\d{10,}$/);
    expect(String(rows[0].Title).length).toBeGreaterThan(0);
    expect(String(rows[0].Url)).toMatch(/^https:\/\/www\.doubao\.com\/chat\//);
  }, 150000);

  it('auth: whoami probe resolves the session identity', async () => {
    const rows = await runDoubaoJsonOrSkip(['doubao', 'whoami'], 'doubao whoami');
    if (rows === null) return;
    const identity = Array.isArray(rows) ? rows[0] : rows;
    expect(String(identity.user_id).length).toBeGreaterThan(0);
    expect(String(identity.name).length).toBeGreaterThan(0);
  }, 150000);

  it('ask: self-question gets a real model reply', async () => {
    const question = '【E2E自测】请只回答数字 7。';
    const rows = await runDoubaoJsonOrSkip(['doubao', 'ask', '--window', 'foreground', question, '--timeout', '90'], 'doubao ask');
    if (rows === null) return;
    const squash = (value) => String(value).replace(/\s+/g, '');
    const texts = rows.map((row) => squash(row.Text));
    expect(texts.some((text) => text.includes(squash(question)))).toBe(true);
    expect(texts.some((text) => text.length > 0 && text !== squash(question))).toBe(true);
  }, 180000);

  it('detail: reads a real conversation by id taken from history', async () => {
    const history = await runDoubaoJsonOrSkip(['doubao', 'history', '--limit', '1'], 'doubao history for id');
    if (history === null) return;
    const id = String(history[0].Id);
    expect(id).toMatch(/^\d{10,}$/);
    const detail = await runDoubaoJsonOrSkip(['doubao', 'detail', id], 'doubao detail');
    if (detail === null) return;
    expect(detail.length).toBeGreaterThanOrEqual(1);
  }, 150000);

  it('new: opens a fresh conversation (leaves one tagged item in the account)', async () => {
    const rows = await runDoubaoJsonOrSkip(['doubao', 'new'], 'doubao new');
    if (rows === null) return;
    expect(String(rows[0].Status)).toBe('Success');
  }, 150000);
});
