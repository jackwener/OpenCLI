/**
 * 把 status / project 的 uuid 解析为中文名（团队级接口各查一次或按批）
 */

import type { IPage } from '../../src/types.js';
import { onesFetchInPage } from './common.js';
import { getTaskProjectRawId } from './task-helpers.js';

export async function loadTaskStatusLabels(
  page: IPage,
  team: string,
  skipGoto: boolean,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const parsed = (await onesFetchInPage(page, `team/${team}/task_statuses`, {
      method: 'GET',
      skipGoto,
    })) as Record<string, unknown>;
    const list = Array.isArray(parsed.task_statuses)
      ? (parsed.task_statuses as Record<string, unknown>[])
      : [];
    for (const s of list) {
      const id = String(s.uuid ?? '');
      const name = String(s.name ?? '');
      if (id && name) map.set(id, name);
    }
  } catch {
    /* 降级为仅显示 uuid */
  }
  return map;
}

const PROJECT_INFO_CHUNK = 25;

export async function loadProjectLabels(
  page: IPage,
  team: string,
  projectUuids: string[],
  skipGoto: boolean,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ids = [...new Set(projectUuids.filter(Boolean))];
  if (ids.length === 0) return map;

  try {
    for (let i = 0; i < ids.length; i += PROJECT_INFO_CHUNK) {
      const slice = ids.slice(i, i + PROJECT_INFO_CHUNK);
      const q = slice.map(encodeURIComponent).join(',');
      const path = `team/${team}/projects/info?ids=${q}`;
      const parsed = (await onesFetchInPage(page, path, {
        method: 'GET',
        skipGoto,
      })) as Record<string, unknown>;
      const projects = Array.isArray(parsed.projects) ? (parsed.projects as Record<string, unknown>[]) : [];
      for (const p of projects) {
        const id = String(p.uuid ?? '');
        const name = String(p.name ?? '');
        if (id && name) map.set(id, name);
      }
    }
  } catch {
    /* 降级 */
  }
  return map;
}

export async function resolveTaskListLabels(
  page: IPage,
  team: string,
  entries: Record<string, unknown>[],
  skipGoto: boolean,
): Promise<{ statusByUuid: Map<string, string>; projectByUuid: Map<string, string> }> {
  const projectUuids = entries.map((e) => getTaskProjectRawId(e)).filter(Boolean);
  const [statusByUuid, projectByUuid] = await Promise.all([
    loadTaskStatusLabels(page, team, skipGoto),
    loadProjectLabels(page, team, projectUuids, skipGoto),
  ]);
  return { statusByUuid, projectByUuid };
}
