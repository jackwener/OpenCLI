/**
 * Log/backfill work hours. Project API paths vary by deployment,
 * so we try common endpoints in sequence.
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import {
  gotoOnesHome,
  onesFetchInPageWithMeta,
  resolveOnesUserUuid,
  summarizeOnesError,
} from './common.js';
import { hoursToOnesManhourRaw } from './task-helpers.js';

function summarizeOnesMutationBody(parsed: unknown, status: number): string | null {
  if (!parsed || typeof parsed !== 'object') {
    return status >= 400 ? `HTTP ${status}` : null;
  }
  const o = parsed as Record<string, unknown>;
  if (Array.isArray(o.errors) && o.errors.length > 0) {
    const e0 = o.errors[0];
    if (e0 && typeof e0 === 'object') {
      const msg = String((e0 as Record<string, unknown>).message ?? '').trim();
      if (msg) return msg;
    }
    return 'graphql errors';
  }
  if (o.data && typeof o.data === 'object') {
    const data = o.data as Record<string, unknown>;
    if (data.addManhour && typeof data.addManhour === 'object') {
      const key = String((data.addManhour as Record<string, unknown>).key ?? '').trim();
      if (!key) return 'addManhour returned empty key';
    }
  }
  if (Array.isArray(o.bad_tasks) && o.bad_tasks.length > 0) {
    const b = o.bad_tasks[0] as Record<string, unknown>;
    return String(b.desc ?? b.code ?? JSON.stringify(b));
  }
  if (typeof o.reason === 'string' && o.reason.trim()) return o.reason.trim();
  const c = o.code;
  if (c !== undefined && c !== null) {
    const n = Number(c);
    if (Number.isFinite(n) && n !== 200 && n !== 0) return `code=${String(c)}`;
  }
  const ec = o.errcode;
  if (typeof ec === 'string' && ec && ec !== 'OK') return ec;
  return null;
}

function describeAttemptFailure(r: { ok: boolean; status: number; parsed: unknown }): string | null {
  if (!r.ok) return summarizeOnesError(r.status, r.parsed);
  return summarizeOnesMutationBody(r.parsed, r.status);
}

function todayLocalYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function validateYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function toLocalMidnightUnixSeconds(ymd: string): number {
  const d = new Date(`${ymd}T00:00:00`);
  const ms = d.getTime();
  if (!Number.isFinite(ms)) return 0;
  return Math.floor(ms / 1000);
}

function pickTaskTotalManhourRaw(parsed: unknown): number | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  const n = Number(o.total_manhour);
  return Number.isFinite(n) ? n : null;
}

export function buildAddManhourGraphqlBody(input: {
  ownerId: string;
  taskId: string;
  startTime: number;
  rawManhour: number;
  note: string;
}): string {
  const { ownerId, taskId, startTime, rawManhour, note } = input;
  const description = JSON.stringify(note);
  const owner = JSON.stringify(ownerId);
  const task = JSON.stringify(taskId);

  return JSON.stringify({
    query: `mutation AddManhour {
  addManhour(
    mode: "simple"
    owner: ${owner}
    task: ${task}
    type: "recorded"
    start_time: ${startTime}
    hours: ${rawManhour}
    description: ${description}
    customData: {}
  ) {
    key
  }
}`,
  });
}

cli({
  site: 'ones',
  name: 'worklog',
  description:
    'ONES — log work hours on a task (defaults to today; use --date to backfill; endpoint falls back by deployment).',
  domain: 'ones.cn',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    {
      name: 'task',
      type: 'str',
      required: true,
      positional: true,
      help: 'Work item UUID (usually 16 chars), from my-tasks or browser URL …/task/<id>',
    },
    {
      name: 'hours',
      type: 'str',
      required: true,
      positional: true,
      help: 'Hours to log for this entry (e.g. 2 or 1.5), converted with ONES_MANHOUR_SCALE',
    },
    {
      name: 'team',
      type: 'str',
      required: false,
      help: 'Team UUID from URL …/team/<uuid>/…, or set ONES_TEAM_UUID',
    },
    {
      name: 'date',
      type: 'str',
      required: false,
      help: 'Entry date YYYY-MM-DD, defaults to today (local timezone); use for backfill',
    },
    {
      name: 'note',
      type: 'str',
      required: false,
      help: 'Optional note (written to description/desc)',
    },
    {
      name: 'owner',
      type: 'str',
      required: false,
      help: 'Owner user UUID (defaults to current logged-in user)',
    },
  ],
  columns: ['task', 'date', 'hours', 'owner', 'endpoint'],

  func: async (page, kwargs) => {
    const taskId = String(kwargs.task ?? '').trim();
    if (!taskId) {
      throw new CliError('CONFIG', 'task uuid required', 'Pass the work item uuid from opencli ones my-tasks or the URL.');
    }

    const team =
      (kwargs.team as string | undefined)?.trim() ||
      process.env.ONES_TEAM_UUID?.trim() ||
      process.env.ONES_TEAM_ID?.trim();
    if (!team) {
      throw new CliError(
        'CONFIG',
        'team UUID required',
        'Pass --team or set ONES_TEAM_UUID (from …/team/<team>/…).',
      );
    }

    const hoursHuman = Number(String(kwargs.hours ?? '').replace(/,/g, ''));
    if (!Number.isFinite(hoursHuman) || hoursHuman <= 0 || hoursHuman > 1000) {
      throw new CliError(
        'CONFIG',
        'hours must be a positive number (hours)',
        'Example: opencli ones worklog <taskUUID> 2 --team <teamUUID>',
      );
    }

    const dateArg = (kwargs.date as string | undefined)?.trim();
    const dateStr = dateArg || todayLocalYmd();
    if (!validateYmd(dateStr)) {
      throw new CliError('CONFIG', 'invalid --date', 'Use YYYY-MM-DD, e.g. 2026-03-24.');
    }

    const note = String(kwargs.note ?? '').trim();
    const rawManhour = hoursToOnesManhourRaw(hoursHuman);
    const startTime = toLocalMidnightUnixSeconds(dateStr);
    if (!startTime) {
      throw new CliError('CONFIG', 'invalid date for start_time', `Could not parse date ${dateStr}.`);
    }

    await gotoOnesHome(page);

    const ownerFromKw = (kwargs.owner as string | undefined)?.trim();
    const ownerId = ownerFromKw || (await resolveOnesUserUuid(page, { skipGoto: true }));

    const entry: Record<string, unknown> = {
      owner: ownerId,
      manhour: rawManhour,
      start_date: dateStr,
      end_date: dateStr,
      desc: note,
    };
    const entryAlt: Record<string, unknown> = {
      owner: ownerId,
      allManhour: rawManhour,
      startDate: dateStr,
      endDate: dateStr,
      desc: note,
    };

    const enc = encodeURIComponent(taskId);
    const gqlBody = buildAddManhourGraphqlBody({
      ownerId,
      taskId,
      startTime,
      rawManhour,
      note,
    });
    const attempts: { path: string; body: string }[] = [
      { path: `team/${team}/items/graphql`, body: gqlBody },
      { path: `team/${team}/task/${enc}/manhours/add`, body: JSON.stringify(entry) },
      { path: `team/${team}/task/${enc}/manhours/add`, body: JSON.stringify(entryAlt) },
      { path: `team/${team}/task/${enc}/manhours/add`, body: JSON.stringify({ manhours: [entry] }) },
      { path: `team/${team}/task/${enc}/manhours/add`, body: JSON.stringify({ manhours: [entryAlt] }) },
      { path: `team/${team}/task/${enc}/manhour/add`, body: JSON.stringify(entry) },
      { path: `team/${team}/task/${enc}/manhour/add`, body: JSON.stringify(entryAlt) },
      {
        path: `team/${team}/tasks/update3`,
        body: JSON.stringify({
          tasks: [{ uuid: taskId, manhours: [entry] }],
        }),
      },
    ];

    const beforeInfo = await onesFetchInPageWithMeta(page, `team/${team}/task/${enc}/info`, {
      method: 'GET',
      skipGoto: true,
    });
    const beforeTotal = beforeInfo.ok ? pickTaskTotalManhourRaw(beforeInfo.parsed) : null;

    let lastDetail = '';
    for (const { path, body } of attempts) {
      const r = await onesFetchInPageWithMeta(page, path, {
        method: 'POST',
        body,
        skipGoto: true,
      });
      const fail = describeAttemptFailure(r);
      if (!fail) {
        // Guard against false success: HTTP 200 but no actual manhour change.
        const afterInfo = await onesFetchInPageWithMeta(page, `team/${team}/task/${enc}/info`, {
          method: 'GET',
          skipGoto: true,
        });
        if (afterInfo.ok) {
          const afterTotal = pickTaskTotalManhourRaw(afterInfo.parsed);
          const changed =
            beforeTotal === null
              ? afterTotal !== null
              : afterTotal !== null && Math.abs(afterTotal - beforeTotal) >= 1;
          if (changed) {
            return [
              {
                task: taskId,
                date: dateStr,
                hours: String(hoursHuman),
                owner: ownerId,
                endpoint: path,
              },
            ];
          }
          lastDetail = `no effect (total_manhour ${String(beforeTotal)} -> ${String(afterTotal)})`;
          continue;
        }
        // If verification read fails, return success conservatively.
        return [
          {
            task: taskId,
            date: dateStr,
            hours: String(hoursHuman),
            owner: ownerId,
            endpoint: path,
          },
        ];
      }
      lastDetail = fail;
    }

    throw new CliError(
      'FETCH_ERROR',
      `ONES worklog: all endpoints failed (last: ${lastDetail})`,
    );
  },
});
