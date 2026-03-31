/**
 * Jimeng AI list tasks — view recent generation history (images + videos).
 *
 * Supports two API response schemas:
 *   - New (2026-03+): data.records_list[] with top-level status/created_time/history_record_id,
 *     detail nested under item_list[0]
 *   - Old: data.history_list[] with common_attr.status/create_time, detail at top level
 */

import { cli, Strategy } from '../../registry.js';
import { AuthRequiredError, CommandExecutionError } from '../../errors.js';
import type { IPage } from '../../types.js';

const JIMENG_API = '/mweb/v1';
const COMMON_PARAMS = 'aid=513695&web_version=7.5.0&da_version=3.3.12';

async function jimengFetch(
  page: IPage,
  endpoint: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  const url = `${JIMENG_API}/${endpoint}?${COMMON_PARAMS}`;
  const js = `
    fetch(${JSON.stringify(url)}, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: ${JSON.stringify(JSON.stringify(body))}
    }).then(r => r.json())
  `;
  return (await page.evaluate(js)) as Record<string, unknown>;
}

function checkRet(res: Record<string, unknown>, context: string): void {
  const ret = res.ret;
  if (ret === '1014' || ret === 1014) {
    throw new AuthRequiredError('jimeng.jianying.com', 'Not logged in');
  }
  if (ret !== '0' && ret !== 0) {
    throw new CommandExecutionError(
      `${context} failed: ret=${ret} errmsg=${(res.errmsg as string) || ''}`,
    );
  }
}

// generate_type mapping
const GEN_TYPE_MAP: Record<number, string> = {
  1: 'image',
  2: 'video',
  12: 'image',
};

const STATUS_MAP: Record<number, string> = {
  10: 'queued',
  20: 'processing',
  30: 'failed',
  50: 'completed',
  100: 'processing',
  102: 'completed',
  103: 'failed',
};

/* eslint-disable @typescript-eslint/no-explicit-any */
interface NormalizedTask {
  task_id: string;
  prompt: string;
  status: string;
  type: string;
  url: string;
  created_at: string;
}

/**
 * Normalize a history record from either old or new API schema into a
 * consistent NormalizedTask shape.
 *
 * Old schema (history_list):
 *   - record.history_id, record.common_attr.{status, create_time, title}
 *   - record.aigc_image_params.text2image_params.prompt
 *   - record.image.large_images[0].image_url
 *   - record.item_list[0].video_url (video items)
 *
 * New schema (records_list):
 *   - record.history_record_id, record.status, record.created_time
 *   - record.item_list[0].aigc_image_params.text2image_params.prompt
 *   - record.item_list[0].image.large_images[0].image_url
 *   - record.item_list[0].common_attr.video_url
 */
export function normalizeRecord(record: any): NormalizedTask {
  const i0 = record.item_list?.[0];

  // task_id: new → history_record_id, old → history_id
  const taskId = record.history_record_id || record.history_id || '';

  // status: new → record.status, old → record.common_attr.status or i0.common_attr.status
  const statusCode =
    record.status ??
    record.common_attr?.status ??
    i0?.common_attr?.status ??
    0;
  const status = STATUS_MAP[statusCode] || `unknown(${statusCode})`;

  // prompt: new → i0.aigc_image_params..., old → record.aigc_image_params...
  const prompt =
    i0?.aigc_image_params?.text2image_params?.prompt ||
    record.aigc_image_params?.text2image_params?.prompt ||
    i0?.common_attr?.prompt ||
    record.common_attr?.title ||
    '';

  // type: new → record.generate_type, old → infer from content
  let type = GEN_TYPE_MAP[record.generate_type ?? 0] || 'unknown';

  // url: new → i0 nested, old → top-level
  let url = '';
  // Video URL: new nested or old top-level
  const videoUrl =
    i0?.common_attr?.video_url ||
    (record.item_list?.[0] as any)?.video_url ||
    '';
  // Image URL: new nested or old top-level
  const imageUrl =
    i0?.image?.large_images?.[0]?.image_url ||
    record.image?.large_images?.[0]?.image_url ||
    '';

  if (videoUrl) {
    type = 'video';
    url = videoUrl;
  } else if (imageUrl) {
    type = type === 'unknown' ? 'image' : type;
    url = imageUrl;
  }

  // created_at: new → record.created_time (float seconds), old → record.common_attr.create_time (int seconds)
  const timestamp =
    record.created_time ||
    record.common_attr?.create_time ||
    i0?.common_attr?.create_time ||
    0;
  const createdAt = timestamp
    ? new Date(timestamp * 1000).toLocaleString('zh-CN')
    : '';

  return {
    task_id: taskId,
    prompt: prompt.length > 50 ? prompt.substring(0, 47) + '...' : prompt,
    status,
    type,
    url,
    created_at: createdAt,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

cli({
  site: 'jimeng',
  name: 'list_task',
  description: '即梦AI 查历史任务 — 列出最近生成的图片/视频任务',
  domain: 'jimeng.jianying.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'limit', type: 'int', default: 10, help: '返回条数（默认 10）' },
  ],
  columns: ['task_id', 'prompt', 'status', 'type', 'url', 'created_at'],
  navigateBefore: 'https://jimeng.jianying.com/ai-tool/generate?type=video&workspace=0',

  func: async (page: IPage, kwargs) => {
    const limit = kwargs.limit as number;

    const resp = await jimengFetch(page, 'get_history', {
      cursor: '',
      count: limit,
      need_page_item: true,
      need_aigc_data: true,
      aigc_mode_list: ['workbench'],
    });
    checkRet(resp, 'get_history');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = resp.data as any;
    const items = data?.records_list || data?.history_list || [];

    return items.slice(0, limit).map(normalizeRecord);
  },
});
