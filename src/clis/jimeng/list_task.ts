/**
 * Jimeng AI list tasks — view recent generation history (images + videos).
 *
 * The get_history API separates images and videos via the `type` body param:
 *   - omitted → image records (generate_type 1/12)
 *   - 'video' → video records (generate_type 2/10)
 *
 * To show both, we issue two requests and merge by created_time desc.
 *
 * Video-specific fields:
 *   - URL: item_list[0].video.transcoded_video["1080p"|"720p"|"360p"].video_url
 *   - Prompt: parsed from draft_content JSON →
 *       component_list[0].abilities.gen_video.text_to_video_params
 *       .video_gen_inputs[0].prompt (text-to-video)
 *       or .unified_edit_input.meta_list[].text (ref-image-to-video)
 *
 * Supports two API response schemas:
 *   - New (2026-03+): data.records_list[]
 *   - Old: data.history_list[]
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
  10: 'video',
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
  model: string;
  status: string;
  type: string;
  url: string;
  created_at: string;
}

/**
 * Extract the best video URL from transcoded_video, preferring higher quality.
 */
function extractVideoUrl(item: any): string {
  const transcoded = item?.video?.transcoded_video;
  if (!transcoded) return item?.common_attr?.video_url || item?.video_url || '';
  for (const quality of ['1080p', '720p', '480p', '360p']) {
    if (transcoded[quality]?.video_url) return transcoded[quality].video_url;
  }
  return item?.common_attr?.video_url || item?.video_url || '';
}

/**
 * Extract prompt from draft_content JSON for video records.
 * Video prompts are stored in the draft differently from images:
 *   - text-to-video: video_gen_inputs[0].prompt
 *   - ref-image-to-video: video_gen_inputs[0].unified_edit_input.meta_list[].text
 */
function parseDraftContent(record: any): { prompt: string; model: string } {
  try {
    const draft =
      typeof record.draft_content === 'string'
        ? JSON.parse(record.draft_content)
        : record.draft_content;
    const comp = draft?.component_list?.[0];
    const genVideo = comp?.abilities?.gen_video?.text_to_video_params;
    const model = genVideo?.model_req_key || '';
    const inp = genVideo?.video_gen_inputs?.[0];
    let prompt = inp?.prompt || '';
    if (!prompt) {
      // ref-image mode: prompt in unified_edit_input.meta_list
      const metaList = inp?.unified_edit_input?.meta_list;
      if (Array.isArray(metaList)) {
        for (const meta of metaList) {
          if (meta.meta_type === 'text' && meta.text) { prompt = meta.text; break; }
        }
      }
    }
    return { prompt, model };
  } catch {
    return { prompt: '', model: '' };
  }
}

/**
 * Normalize a history record from either old or new API schema into a
 * consistent NormalizedTask shape.
 */
export function normalizeRecord(record: any): NormalizedTask {
  const i0 = record.item_list?.[0];

  const taskId = record.history_record_id || record.history_id || '';

  const statusCode =
    record.status ??
    record.common_attr?.status ??
    i0?.common_attr?.status ??
    0;
  const status = STATUS_MAP[statusCode] || `unknown(${statusCode})`;

  // type from generate_type
  let type = GEN_TYPE_MAP[record.generate_type ?? 0] || 'unknown';

  // model: new → record.model_info.model_name, video → draft_content.model_req_key
  // old → i0.aigc_image_params.text2image_params.model_config.model_name
  let model =
    record.model_info?.model_name ||
    i0?.aigc_image_params?.text2image_params?.model_config?.model_name ||
    record.aigc_image_params?.text2image_params?.model_config?.model_name ||
    '';

  // prompt: try standard image params first, then draft_content for videos
  let prompt =
    i0?.aigc_image_params?.text2image_params?.prompt ||
    record.aigc_image_params?.text2image_params?.prompt ||
    i0?.common_attr?.prompt ||
    record.common_attr?.title ||
    '';
  if (record.draft_content) {
    const draft = parseDraftContent(record);
    if (!prompt) prompt = draft.prompt;
    if (!model) model = draft.model;
  }

  // url: check video transcoded URLs, then image URLs
  let url = '';
  const videoUrl = i0 ? extractVideoUrl(i0) : '';
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
    model,
    status,
    type,
    url,
    created_at: createdAt,
  };
}

function extractItems(data: any): any[] {
  return data?.records_list || data?.history_list || [];
}

async function fetchHistory(
  page: IPage,
  limit: number,
  workspace: string,
  apiType?: string,
): Promise<any[]> {
  // Fetch extra records when workspace filter is active, since the API
  // does not support server-side workspace filtering — we filter client-side.
  const fetchCount = workspace !== '' ? Math.max(limit * 3, 30) : limit;
  const body: Record<string, any> = {
    cursor: '',
    count: fetchCount,
    need_page_item: true,
    need_aigc_data: true,
    aigc_mode_list: ['workbench'],
  };
  if (apiType) {
    body.type = apiType;
  }

  const resp = await jimengFetch(page, 'get_history', body);
  checkRet(resp, 'get_history');
  let items = extractItems(resp.data as any);

  // Client-side workspace filtering (API ignores workspace_id in body)
  if (workspace !== '') {
    const wsId = parseInt(workspace) || 0;
    items = items.filter((r: any) => r.workspace_id === wsId);
  }
  return items;
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
    { name: 'workspace', type: 'string', default: '', help: '工作区 ID（留空查全部，0=默认）' },
    { name: 'type', type: 'string', default: '', help: '过滤类型：image/video（留空显示全部）' },
  ],
  columns: ['task_id', 'prompt', 'model', 'status', 'type', 'url', 'created_at'],
  navigateBefore: 'https://jimeng.jianying.com/ai-tool/generate?type=video&workspace=0',

  func: async (page: IPage, kwargs) => {
    const limit = kwargs.limit as number;
    const workspace = kwargs.workspace as string;
    const typeFilter = kwargs.type as string;

    if (typeFilter === 'video') {
      const items = await fetchHistory(page, limit, workspace, 'video');
      return items.slice(0, limit).map(normalizeRecord);
    } else if (typeFilter === 'image') {
      const items = await fetchHistory(page, limit, workspace);
      return items.slice(0, limit).map(normalizeRecord);
    }

    // Both: fetch images and videos, merge by created_time desc, deduplicate
    const [imageItems, videoItems] = await Promise.all([
      fetchHistory(page, limit, workspace),
      fetchHistory(page, limit, workspace, 'video'),
    ]);
    // Deduplicate by history_record_id / history_id
    const seen = new Set<string>();
    const merged: any[] = [];
    for (const item of [...imageItems, ...videoItems]) {
      const id = item.history_record_id || item.history_id || '';
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      merged.push(item);
    }
    // Sort by timestamp descending
    merged.sort((a: any, b: any) => {
      const ta = a.created_time || a.common_attr?.create_time || 0;
      const tb = b.created_time || b.common_attr?.create_time || 0;
      return tb - ta;
    });
    return merged.slice(0, limit).map(normalizeRecord);
  },
});
