import { cli, Strategy } from '../../src/registry.js';
import { CliError } from '../../src/errors.js';
import type { IPage } from '../../src/types.js';
import { gotoOnesHome, onesFetchInPage, resolveOnesUserUuid } from './common.js';
import { enrichPeekEntriesWithDetails } from './enrich-tasks.js';
import { resolveTaskListLabels } from './resolve-labels.js';
import {
  defaultPeekBody,
  flattenPeekGroups,
  mapTaskEntry,
  parsePeekLimit,
} from './task-helpers.js';

/** 文档示例里「负责人」常用 field004；与顶层 assign 在不同部署上二选一有效 */
function queryAssign(userUuid: string): Record<string, unknown> {
  return { must: [{ equal: { assign: userUuid } }] };
}

function queryAssignField004(userUuid: string): Record<string, unknown> {
  return { must: [{ in: { 'field_values.field004': [userUuid] } }] };
}

function queryOwner(userUuid: string): Record<string, unknown> {
  return { must: [{ equal: { owner: userUuid } }] };
}

function dedupeByUuid(entries: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  for (const e of entries) {
    const id = String(e.uuid ?? '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(e);
  }
  return out;
}

async function peekTasks(
  page: IPage,
  team: string,
  query: Record<string, unknown>,
  cap: number,
): Promise<Record<string, unknown>[]> {
  const path = `team/${team}/filters/peek`;
  const body = defaultPeekBody(query);
  const parsed = (await onesFetchInPage(page, path, {
    method: 'POST',
    body: JSON.stringify(body),
    skipGoto: true,
  })) as Record<string, unknown>;
  return flattenPeekGroups(parsed, cap);
}

cli({
  site: 'ones',
  name: 'my-tasks',
  description:
    'ONES — my work items (filters/peek + strict must query). Default: assignee=me. Use --mode if your site uses field004 for assignee.',
  domain: 'ones.cn',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    {
      name: 'team',
      type: 'str',
      required: false,
      positional: true,
      help: 'Team UUID from URL …/team/<uuid>/…, or set ONES_TEAM_UUID',
    },
    {
      name: 'limit',
      type: 'int',
      default: 100,
      help: 'Max rows (default 100, max 500)',
    },
    {
      name: 'mode',
      type: 'str',
      default: 'assign',
      choices: ['assign', 'field004', 'owner', 'both'],
      help:
        'assign=负责人(顶层 assign)；field004=负责人(筛选器示例里的 field004)；owner=创建者；both=负责人∪创建者(两次 peek 去重)',
    },
  ],
  columns: ['title', 'status', 'project', 'uuid', 'updated', '工时'],

  func: async (page, kwargs) => {
    const team =
      (kwargs.team as string | undefined)?.trim() ||
      process.env.ONES_TEAM_UUID?.trim() ||
      process.env.ONES_TEAM_ID?.trim();
    if (!team) {
      throw new CliError(
        'CONFIG',
        'team UUID required',
        'Pass team from URL …/team/<team>/… or set ONES_TEAM_UUID.',
      );
    }

    const limit = parsePeekLimit(kwargs.limit, 100);
    const mode = String(kwargs.mode ?? 'assign');

    await gotoOnesHome(page);
    const userUuid = await resolveOnesUserUuid(page, { skipGoto: true });

    let entries: Record<string, unknown>[] = [];

    if (mode === 'both') {
      const cap = Math.min(500, limit * 2);
      const asAssign = await peekTasks(page, team, queryAssign(userUuid), cap);
      const asOwner = await peekTasks(page, team, queryOwner(userUuid), cap);
      entries = dedupeByUuid([...asAssign, ...asOwner]).slice(0, limit);
    } else {
      const queryByMode = (): Record<string, unknown> => {
        switch (mode) {
          case 'field004':
            return queryAssignField004(userUuid);
          case 'owner':
            return queryOwner(userUuid);
          case 'assign':
          default:
            return queryAssign(userUuid);
        }
      };

      const primary = queryByMode();
      try {
        entries = await peekTasks(page, team, primary, limit);
      } catch (e) {
        const msg = e instanceof Error ? e.message : '';
        const canFallback =
          mode === 'assign' &&
          (msg.includes('ServerError') || msg.includes('801') || msg.includes('Params is invalid'));
        if (canFallback) {
          entries = await peekTasks(page, team, queryAssignField004(userUuid), limit);
        } else {
          throw e;
        }
      }
    }

    const enriched = await enrichPeekEntriesWithDetails(page, team, entries, true);
    const labels = await resolveTaskListLabels(page, team, enriched, true);
    return enriched.map((e) => mapTaskEntry(e, labels));
  },
});
