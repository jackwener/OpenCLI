/**
 * Jimeng AI list tasks — view recent generation history (images + videos).
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
};

interface RecordItem {
  history_record_id?: string;
  generate_type?: number;
  status?: number;
  created_time?: number;
  submit_id?: string;
  model_info?: { model_name?: string };
  item_list?: Array<{
    common_attr?: { video_url?: string; prompt?: string; cover_url?: string };
    image?: { large_images?: Array<{ image_url?: string }> };
    aigc_image_params?: { text2image_params?: { prompt?: string } };
  }>;
  draft_content?: string;
}

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

    const data = resp.data as { records_list?: RecordItem[]; history_list?: RecordItem[] } | undefined;
    const items = data?.records_list || data?.history_list || [];

    return items.slice(0, limit).map((record) => {
      const statusCode = record.status ?? 0;
      const statusText = STATUS_MAP[statusCode] || `unknown(${statusCode})`;

      const i0 = record.item_list?.[0];
      const prompt =
        i0?.aigc_image_params?.text2image_params?.prompt ||
        i0?.common_attr?.prompt ||
        '';

      // Determine type and URL
      const genType = GEN_TYPE_MAP[record.generate_type ?? 0] || 'unknown';
      let url = '';

      if (i0?.common_attr?.video_url) {
        url = i0.common_attr.video_url;
      } else if (i0?.image?.large_images?.[0]?.image_url) {
        url = i0.image.large_images[0].image_url;
      }

      const createdAt = record.created_time
        ? new Date(record.created_time * 1000).toLocaleString('zh-CN')
        : '';

      return {
        task_id: record.history_record_id || '',
        prompt: prompt.length > 50 ? prompt.substring(0, 47) + '...' : prompt,
        status: statusText,
        type: genType,
        url,
        created_at: createdAt,
      };
    });
  },
});
