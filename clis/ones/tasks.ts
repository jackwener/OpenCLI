import { cli, Strategy } from '../../src/registry.js';
import { CliError } from '../../src/errors.js';
import { gotoOnesHome, onesFetchInPage } from './common.js';
import { enrichPeekEntriesWithDetails } from './enrich-tasks.js';
import { resolveTaskListLabels } from './resolve-labels.js';
import { defaultPeekBody, flattenPeekGroups, mapTaskEntry, parsePeekLimit } from './task-helpers.js';

function buildQuery(project?: string, assign?: string): Record<string, unknown> {
  const must: unknown[] = [];
  if (project?.trim()) {
    must.push({ in: { 'field_values.field006': [project.trim()] } });
  }
  if (assign?.trim()) {
    must.push({ equal: { assign: assign.trim() } });
  }
  if (must.length === 0) {
    return { must: [] };
  }
  return { must };
}

cli({
  site: 'ones',
  name: 'tasks',
  description:
    'ONES Project API — list work items (POST team/:team/filters/peek); use token-info -f json for team uuid',
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
      help: 'Team UUID (8 chars), or set ONES_TEAM_UUID',
    },
    {
      name: 'project',
      type: 'str',
      required: false,
      help: 'Filter by project UUID (field006 / 所属项目)',
    },
    {
      name: 'assign',
      type: 'str',
      required: false,
      help: 'Filter by assignee user UUID (负责人 assign)',
    },
    {
      name: 'limit',
      type: 'int',
      default: 30,
      help: 'Max rows after flattening groups (default 30)',
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
        'Pass team as first argument or set ONES_TEAM_UUID (see `opencli ones token-info -f json` → teams[].uuid).',
      );
    }

    const project = (kwargs.project as string | undefined)?.trim();
    const assign = (kwargs.assign as string | undefined)?.trim();
    const limit = parsePeekLimit(kwargs.limit, 30);

    await gotoOnesHome(page);

    const body = defaultPeekBody(buildQuery(project, assign));
    const path = `team/${team}/filters/peek`;
    const parsed = (await onesFetchInPage(page, path, {
      method: 'POST',
      body: JSON.stringify(body),
      skipGoto: true,
    })) as Record<string, unknown>;

    const entries = flattenPeekGroups(parsed, limit);
    const enriched = await enrichPeekEntriesWithDetails(page, team, entries, true);
    const labels = await resolveTaskListLabels(page, team, enriched, true);
    return enriched.map((e) => mapTaskEntry(e, labels));
  },
});
