import { beforeAll, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { isManusUrl } from './_utils.js';
import './status.js';
import './list.js';
import './read.js';
import './credits.js';
import './connectors.js';
import './skills.js';

// ── Mock data (matching spec response samples) ─────────────────────────────

const USER_INFO = {
  userId: '310519663277886366',
  email: 'test@example.com',
  displayname: 'Test User',
  membershipTier: 'MEMBERSHIP_TIER_PRO',
  firstname: 'Test',
};

const CREDITS = {
  totalCredits: 12311,
  freeCredits: 11,
  periodicCredits: 12000,
  proMonthlyCredits: 12000,
  refreshCredits: 300,
  maxRefreshCredits: 300,
  nextRefreshTime: '2026-06-03T16:00:00Z',
  refreshInterval: 'daily',
};

const SESSIONS = {
  sessions: [
    {
      uid: '8UcpCxMFLrNk63ZJmzALfV',
      userId: '310519663277886366',
      title: 'PPT task',
      status: 'SESSION_STATUS_STOPPED',
      lastDisplayMessage: '已 完成修改',
      lastMessageTime: '2026-05-04T06:39:47.774Z',
      createdAt: '2026-04-30T07:54:17.891Z',
      updatedAt: '2026-05-26T06:23:41Z',
      agentTaskMode: 2,
      costedCredits: 4564,
      isArchived: false,
    },
    {
      uid: 'YOpdpcVj7vPFD4gsBfEwVu',
      title: 'Empire task',
      status: 'SESSION_STATUS_STOPPED',
      costedCredits: 5443,
      isArchived: false,
    },
    {
      uid: 'archived1',
      title: 'Old task',
      status: 'SESSION_STATUS_STOPPED',
      isArchived: true,
      costedCredits: 100,
    },
  ],
};

const CONNECTORS = {
  connectors: [
    { uid: 'cf19c9d0-5f91', name: 'Apify', brief: 'Connect AI agents to web scrapers' },
    { uid: 'abc', name: 'GitHub', brief: 'Read repos' },
  ],
};

const SKILLS = {
  userAddedSkills: [
    { id: 'R6qVrCn2', name: 'manus-api', description: 'Manage tasks via API' },
  ],
};

// ── makePage helper (queue pattern matching kimi.test.js) ─────────────────

/**
 * Create a mock page with a queue of page.evaluate results.
 * Each call to page.evaluate consumes one item from the queue.
 * Once the queue is exhausted, further calls resolve to null.
 */
function makePage(evaluateResults = []) {
  const evaluate = vi.fn();
  for (const result of evaluateResults) {
    evaluate.mockResolvedValueOnce(result);
  }
  evaluate.mockResolvedValue(null);
  return {
    evaluate,
    goto: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * makePage variant that prepends a manus.im URL — ensureOnManus first reads
 * location.href via page.evaluate, so the queue's first slot is consumed by
 * that URL check before the actual RPC result is reached.
 */
function manusPage(...rpcResults) {
  return makePage(['https://manus.im/app', ...rpcResults]);
}

function envelope(data) {
  return { session: { id: 'browser-session' }, data };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Registration
// ═══════════════════════════════════════════════════════════════════════════

describe('manus adapter registration', () => {
  it('registers 6 read-only commands with manus.im domain', () => {
    const expected = {
      status: 'read',
      list: 'read',
      read: 'read',
      credits: 'read',
      connectors: 'read',
      skills: 'read',
    };
    for (const [name, access] of Object.entries(expected)) {
      const cmd = getRegistry().get(`manus/${name}`);
      expect(cmd, `manus/${name}`).toBeDefined();
      expect(cmd.access).toBe(access);
      expect(cmd.domain).toBe('manus.im');
      expect(cmd.siteSession).toBe('persistent');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. manus/status
// ═══════════════════════════════════════════════════════════════════════════

describe('manus status', () => {
  const statusCmd = getRegistry().get('manus/status');

  it('returns merged UserInfo + credits as Field/Value rows', async () => {
    const page = manusPage({ userInfo: USER_INFO, credits: CREDITS });
    const rows = await statusCmd.func(page, {});
    expect(Array.isArray(rows)).toBe(true);
    const map = Object.fromEntries(rows.map((r) => [r.Field, r.Value]));
    expect(map['Email']).toBe('test@example.com');
    expect(map['Display Name']).toBe('Test User');
    expect(map['Membership Tier']).toBe('MEMBERSHIP_TIER_PRO');
    expect(map['Total Credits']).toBe(12311);
    expect(map['Refresh Credits']).toBe(300);
    // Every row must have Field and Value columns
    for (const row of rows) {
      expect(row).toHaveProperty('Field');
      expect(row).toHaveProperty('Value');
    }
  });

  it('unwraps Browser Bridge envelopes and fails closed on missing user identity', async () => {
    const page = manusPage(envelope({ userInfo: USER_INFO, credits: CREDITS }));
    const rows = await statusCmd.func(page, {});
    expect(Object.fromEntries(rows.map((r) => [r.Field, r.Value]))['User ID']).toBe('310519663277886366');

    await expect(statusCmd.func(manusPage({ userInfo: {}, credits: CREDITS }), {})).rejects.toBeInstanceOf(
      CommandExecutionError,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. manus/list
// ═══════════════════════════════════════════════════════════════════════════

describe('manus list', () => {
  const listCmd = getRegistry().get('manus/list');

  it('returns non-archived sessions by default', async () => {
    const page = manusPage(SESSIONS);
    const rows = await listCmd.func(page, {});
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: '8UcpCxMFLrNk63ZJmzALfV', Title: 'PPT task' });
    expect(rows[1]).toMatchObject({ id: 'YOpdpcVj7vPFD4gsBfEwVu', Title: 'Empire task' });
  });

  it('unwraps Browser Bridge envelopes for session list responses', async () => {
    const page = manusPage(envelope(SESSIONS));
    const rows = await listCmd.func(page, {});
    expect(rows[0].id).toBe('8UcpCxMFLrNk63ZJmzALfV');
  });

  it('returns all sessions when --archived is passed', async () => {
    const page = manusPage(SESSIONS);
    const rows = await listCmd.func(page, { archived: true });
    expect(rows).toHaveLength(3);
  });

  it('passes pageSize via --limit to evaluate body', async () => {
    const page = manusPage(SESSIONS);
    await listCmd.func(page, { limit: 1 });
    // ensureOnManus eats the first evaluate call (URL probe); the RPC
    // call is the second. Assert pageSize:1 was interpolated into it.
    const rpcCallSrc = page.evaluate.mock.calls[1][0];
    expect(rpcCallSrc).toMatch(/pageSize:\s*1/);
    expect(rpcCallSrc).toContain('session.v1.SessionService/ListSessions');
  });

  it('rejects --limit 0 and other non-positive limits', async () => {
    const page = manusPage(SESSIONS);
    await expect(listCmd.func(page, { limit: 0 })).rejects.toBeInstanceOf(ArgumentError);
    await expect(listCmd.func(page, { limit: -5 })).rejects.toBeInstanceOf(ArgumentError);
    await expect(listCmd.func(page, { limit: 1.5 })).rejects.toBeInstanceOf(ArgumentError);
  });

  it('throws CommandExecutionError for malformed list payloads and rows', async () => {
    await expect(listCmd.func(manusPage({}), {})).rejects.toBeInstanceOf(CommandExecutionError);
    await expect(listCmd.func(manusPage({ sessions: [{ title: 'missing uid' }] }), {})).rejects.toBeInstanceOf(
      CommandExecutionError,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. manus/read
// ═══════════════════════════════════════════════════════════════════════════

describe('manus read', () => {
  const readCmd = getRegistry().get('manus/read');

  it('returns session detail as vertical Field/Value rows for found uid', async () => {
    const page = manusPage(SESSIONS);
    const rows = await readCmd.func(page, { uid: '8UcpCxMFLrNk63ZJmzALfV' });
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const map = Object.fromEntries(rows.map((r) => [r.Field, r.Value]));
    expect(map['UID']).toBe('8UcpCxMFLrNk63ZJmzALfV');
    expect(map['Title']).toBe('PPT task');
    expect(map['Status']).toBe('SESSION_STATUS_STOPPED');
  });

  it('throws EmptyResultError when uid is not found in sessions', async () => {
    const page = manusPage(SESSIONS);
    await expect(readCmd.func(page, { uid: 'nonexistent' })).rejects.toBeInstanceOf(
      EmptyResultError,
    );
  });

  it('throws ArgumentError when uid is missing', async () => {
    const page = manusPage();
    await expect(readCmd.func(page, {})).rejects.toBeInstanceOf(ArgumentError);
  });

  it('throws CommandExecutionError when read receives malformed session payload', async () => {
    const page = manusPage({});
    await expect(readCmd.func(page, { uid: '8UcpCxMFLrNk63ZJmzALfV' })).rejects.toBeInstanceOf(
      CommandExecutionError,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. manus/credits
// ═══════════════════════════════════════════════════════════════════════════

describe('manus credits', () => {
  const creditsCmd = getRegistry().get('manus/credits');

  it('returns credit fields as Field/Value rows', async () => {
    const page = manusPage(CREDITS);
    const rows = await creditsCmd.func(page, {});
    expect(rows).toHaveLength(8);
    const map = Object.fromEntries(rows.map((r) => [r.Field, r.Value]));
    expect(map['Total Credits']).toBe(12311);
    expect(map['Free Credits']).toBe(11);
    expect(map['Periodic Credits']).toBe(12000);
    expect(map['Pro Monthly Credits']).toBe(12000);
    expect(map['Refresh Credits']).toBe(300);
    expect(map['Max Refresh Credits']).toBe(300);
    expect(map['Next Refresh']).toBe('2026-06-03T16:00:00Z');
    expect(map['Refresh Interval']).toBe('daily');
  });

  it('unwraps Browser Bridge envelopes and rejects malformed credit payloads', async () => {
    const rows = await creditsCmd.func(manusPage(envelope(CREDITS)), {});
    expect(Object.fromEntries(rows.map((r) => [r.Field, r.Value]))['Total Credits']).toBe(12311);

    await expect(creditsCmd.func(manusPage({}), {})).rejects.toBeInstanceOf(CommandExecutionError);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. manus/connectors
// ═══════════════════════════════════════════════════════════════════════════

describe('manus connectors', () => {
  const connectorsCmd = getRegistry().get('manus/connectors');

  it('returns all connectors as rows', async () => {
    const page = manusPage(CONNECTORS);
    const rows = await connectorsCmd.func(page, {});
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ UID: 'cf19c9d0-5f91', Name: 'Apify' });
    expect(rows[1]).toMatchObject({ UID: 'abc', Name: 'GitHub' });
  });

  it('respects --limit to restrict connector count', async () => {
    const page = manusPage(CONNECTORS);
    const rows = await connectorsCmd.func(page, { limit: 1 });
    expect(rows).toHaveLength(1);
  });

  it('fails closed on malformed connector payloads and rows', async () => {
    await expect(connectorsCmd.func(manusPage({}), {})).rejects.toBeInstanceOf(CommandExecutionError);
    await expect(connectorsCmd.func(manusPage({ connectors: [{ uid: 'missing-name' }] }), {})).rejects.toBeInstanceOf(
      CommandExecutionError,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. manus/skills
// ═══════════════════════════════════════════════════════════════════════════

describe('manus skills', () => {
  const skillsCmd = getRegistry().get('manus/skills');

  it('returns user-added skills with source=user', async () => {
    const page = manusPage(SKILLS);
    const rows = await skillsCmd.func(page, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ID: 'R6qVrCn2',
      Name: 'manus-api',
      Description: 'Manage tasks via API',
      Source: 'user',
    });
  });

  it('fails closed on malformed skill payloads and rows', async () => {
    await expect(skillsCmd.func(manusPage({}), {})).rejects.toBeInstanceOf(CommandExecutionError);
    await expect(skillsCmd.func(manusPage({ userAddedSkills: [{ id: 'missing-name' }] }), {})).rejects.toBeInstanceOf(
      CommandExecutionError,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. Auth error handling
// ═══════════════════════════════════════════════════════════════════════════

describe('manus auth error', () => {
  const statusCmd = getRegistry().get('manus/status');

  it('maps session_id cookie missing payloads to AuthRequiredError', async () => {
    const page = manusPage({ __authRequired: true, message: 'session_id cookie missing' });
    await expect(statusCmd.func(page, {})).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('maps Manus HTTP error payloads to CommandExecutionError', async () => {
    const page = manusPage({ __httpError: 500, message: 'server failed' });
    await expect(statusCmd.func(page, {})).rejects.toBeInstanceOf(CommandExecutionError);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. isManusUrl helper
// ═══════════════════════════════════════════════════════════════════════════

describe('manus URL validation', () => {
  it('accepts valid manus.im URLs', () => {
    expect(isManusUrl('https://manus.im/app')).toBe(true);
    expect(isManusUrl('https://manus.im/app/sessions')).toBe(true);
  });

  it('rejects non-manus URLs', () => {
    expect(isManusUrl('https://other.com')).toBe(false);
    expect(isManusUrl('https://manus.im.evil.com/app')).toBe(false);
  });

  it('rejects http (non-https) URLs', () => {
    expect(isManusUrl('http://manus.im/app')).toBe(false);
  });
});
