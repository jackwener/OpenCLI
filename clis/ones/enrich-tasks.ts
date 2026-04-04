/**
 * peek 列表只有轻量字段，用 batch tasks/info 补全 summary 等（ONES 文档 #7）
 */

import type { IPage } from '../../types.js';
import { onesFetchInPage } from './common.js';

const BATCH_SIZE = 40;

export async function enrichPeekEntriesWithDetails(
  page: IPage,
  team: string,
  entries: Record<string, unknown>[],
  skipGoto: boolean,
): Promise<Record<string, unknown>[]> {
  const ids = [...new Set(entries.map((e) => String(e.uuid ?? '').trim()).filter(Boolean))];
  if (ids.length === 0) return entries;

  const byId = new Map<string, Record<string, unknown>>();

  try {
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const slice = ids.slice(i, i + BATCH_SIZE);
      const parsed = (await onesFetchInPage(page, `team/${team}/tasks/info`, {
        method: 'POST',
        body: JSON.stringify({ ids: slice }),
        skipGoto,
      })) as Record<string, unknown>;

      const tasks = Array.isArray(parsed.tasks) ? (parsed.tasks as Record<string, unknown>[]) : [];
      for (const t of tasks) {
        const id = String(t.uuid ?? '');
        if (id) byId.set(id, t);
      }
    }
  } catch {
    return entries;
  }

  if (byId.size === 0) return entries;

  return entries.map((e) => {
    const id = String(e.uuid ?? '');
    const full = id ? byId.get(id) : undefined;
    return full ? { ...e, ...full } : e;
  });
}
