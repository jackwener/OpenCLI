/**
 * Douyin publish — 8-phase pipeline for scheduling video posts.
 *
 * Phases:
 *   1. STS2 credentials
 *   2. Apply TOS upload URL
 *   3. TOS multipart upload
 *   4. Cover upload (optional, via ImageX)
 *   5. Enable video
 *   6. Poll transcode
 *   7. Content safety check
 *   8. create_v2 publish
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { cli, Strategy } from '../../registry.js';
import { ArgumentError, CommandExecutionError } from '../../errors.js';
import type { IPage } from '../../types.js';
import type { TosUploadInfo } from './_shared/types.js';
import { getSts2Credentials } from './_shared/sts2.js';
import { tosUpload } from './_shared/tos-upload.js';
import { imagexUpload } from './_shared/imagex-upload.js';
import { pollTranscode } from './_shared/transcode.js';
import { browserFetch } from './_shared/browser-fetch.js';
import { generateCreationId } from './_shared/creation-id.js';
import { validateTiming, toUnixSeconds } from './_shared/timing.js';
import { parseTextExtra, extractHashtagNames } from './_shared/text-extra.js';
import type { HashtagInfo } from './_shared/text-extra.js';

const VISIBILITY_MAP: Record<string, number> = {
  public: 0,
  friends: 1,
  private: 2,
};

const IMAGEX_BASE = 'https://imagex.bytedanceapi.com';
const IMAGEX_SERVICE_ID = '1147';

const DEVICE_PARAMS =
  'aid=1128&cookie_enabled=true&screen_width=1512&screen_height=982&browser_language=zh-CN&browser_platform=MacIntel&browser_name=Mozilla&browser_online=true&timezone_name=Asia%2FTokyo&support_h265=1';

const DEFAULT_COVER_TOOLS_INFO = JSON.stringify({
  video_cover_source: 2,
  cover_timestamp: 0,
  recommend_timestamp: 0,
  is_cover_edit: 0,
  is_cover_template: 0,
  cover_template_id: '',
  is_text_template: 0,
  text_template_id: '',
  text_template_content: '',
  is_text: 0,
  text_num: 0,
  text_content: '',
  is_use_sticker: 0,
  sticker_id: '',
  is_use_filter: 0,
  filter_id: '',
  is_cover_modify: 0,
  to_status: 0,
  cover_type: 0,
  initial_cover_uri: '',
  cut_coordinate: '',
});

cli({
  site: 'douyin',
  name: 'publish',
  description: '定时发布视频到抖音（必须设置 2h ~ 14天后的发布时间）',
  domain: 'creator.douyin.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'video', required: true, positional: true, help: '视频文件路径' },
    { name: 'title', required: true, help: '视频标题（≤30字）' },
    { name: 'schedule', required: true, help: '定时发布时间（ISO8601 或 Unix 秒，2h ~ 14天后）' },
    { name: 'caption', default: '', help: '正文内容（≤1000字，支持 #话题）' },
    { name: 'cover', default: '', help: '封面图片路径（不提供时使用视频截帧）' },
    { name: 'visibility', default: 'public', choices: ['public', 'friends', 'private'] },
    { name: 'allow_download', type: 'bool', default: false, help: '允许下载' },
    { name: 'collection', default: '', help: '合集 ID' },
    { name: 'activity', default: '', help: '活动 ID' },
    { name: 'poi_id', default: '', help: '地理位置 ID' },
    { name: 'poi_name', default: '', help: '地理位置名称' },
    { name: 'hotspot', default: '', help: '关联热点词' },
    { name: 'no_safety_check', type: 'bool', default: false, help: '跳过内容安全检测' },
    { name: 'sync_toutiao', type: 'bool', default: false, help: '同步发布到头条' },
  ],
  columns: ['status', 'aweme_id', 'url', 'publish_time'],
  func: async (page: IPage, kwargs) => {
    // ── Fail-fast validation ────────────────────────────────────────────
    const videoPath = path.resolve(kwargs.video as string);
    if (!fs.existsSync(videoPath)) {
      throw new ArgumentError(`视频文件不存在: ${videoPath}`);
    }
    const ext = path.extname(videoPath).toLowerCase();
    if (!['.mp4', '.mov', '.avi', '.webm'].includes(ext)) {
      throw new ArgumentError(`不支持的视频格式: ${ext}（支持 mp4/mov/avi/webm）`);
    }
    const fileSize = fs.statSync(videoPath).size;

    const title = kwargs.title as string;
    if (title.length > 30) {
      throw new ArgumentError('标题不能超过 30 字');
    }

    const caption = (kwargs.caption as string) || '';
    if (caption.length > 1000) {
      throw new ArgumentError('正文不能超过 1000 字');
    }

    const timingTs = toUnixSeconds(kwargs.schedule as string | number);
    validateTiming(timingTs);

    const visibilityType = VISIBILITY_MAP[kwargs.visibility as string] ?? 0;

    const coverPath = kwargs.cover as string;
    if (coverPath) {
      if (!fs.existsSync(path.resolve(coverPath))) {
        throw new ArgumentError(`封面文件不存在: ${path.resolve(coverPath)}`);
      }
    }

    // ── Phase 1: STS2 credentials ───────────────────────────────────────
    const credentials = await getSts2Credentials(page);

    // ── Phase 2: Apply TOS upload URL ───────────────────────────────────
    const vodUrl = `https://vod.bytedanceapi.com/?Action=ApplyVideoUpload&ServiceId=1128&Version=2021-01-01&FileType=video&FileSize=${fileSize}`;
    const vodJs = `fetch(${JSON.stringify(vodUrl)}, { credentials: 'include' }).then(r => r.json())`;
    const vodRes = (await page.evaluate(vodJs)) as {
      Result: {
        UploadAddress: {
          VideoId: string;
          UploadHosts: string[];
          StoreInfos: Array<{ Auth: string; StoreUri: string }>;
        };
      };
    };
    const { VideoId: videoId, UploadHosts, StoreInfos } = vodRes.Result.UploadAddress;
    const tosUrl = `https://${UploadHosts[0]}/${StoreInfos[0].StoreUri}`;
    const tosUploadInfo: TosUploadInfo = {
      tos_upload_url: tosUrl,
      auth: StoreInfos[0].Auth,
      video_id: videoId,
    };

    // ── Phase 3: TOS upload ─────────────────────────────────────────────
    await tosUpload({
      filePath: videoPath,
      uploadInfo: tosUploadInfo,
      credentials,
      onProgress: (uploaded, total) => {
        const pct = Math.round((uploaded / total) * 100);
        process.stderr.write(`\r  上传进度: ${pct}%`);
      },
    });
    process.stderr.write('\n');

    // ── Phase 4: Cover upload (optional) ────────────────────────────────
    let coverUri = '';
    let coverWidth = 720;
    let coverHeight = 1280;

    if (kwargs.cover) {
      const resolvedCoverPath = path.resolve(kwargs.cover as string);

      // 4A: Apply ImageX upload
      const applyUrl = `${IMAGEX_BASE}/?Action=ApplyImageUpload&ServiceId=${IMAGEX_SERVICE_ID}&Version=2018-08-01&UploadNum=1`;
      const applyJs = `fetch(${JSON.stringify(applyUrl)}, { credentials: 'include' }).then(r => r.json())`;
      const applyRes = (await page.evaluate(applyJs)) as {
        Result: {
          UploadAddress: {
            UploadHosts: string[];
            StoreInfos: Array<{ Auth: string; StoreUri: string; UploadHost: string }>;
          };
        };
      };
      const { StoreInfos: imgStoreInfos } = applyRes.Result.UploadAddress;
      const imgUploadUrl = `https://${imgStoreInfos[0].UploadHost}/${imgStoreInfos[0].StoreUri}`;

      // 4B: Upload image
      const coverStoreUri = await imagexUpload(resolvedCoverPath, {
        upload_url: imgUploadUrl,
        store_uri: imgStoreInfos[0].StoreUri,
      });

      // 4C: Commit ImageX upload
      const commitUrl = `${IMAGEX_BASE}/?Action=CommitImageUpload&ServiceId=${IMAGEX_SERVICE_ID}&Version=2018-08-01`;
      const commitBody = JSON.stringify({ SuccessObjKeys: [coverStoreUri] });
      const commitJs = `
        fetch(${JSON.stringify(commitUrl)}, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: ${JSON.stringify(commitBody)}
        }).then(r => r.json())
      `;
      await page.evaluate(commitJs);

      coverUri = coverStoreUri;
    }

    // ── Phase 5: Enable video ───────────────────────────────────────────
    const enableUrl = `https://creator.douyin.com/web/api/media/video/enable/?video_id=${videoId}&aid=1128`;
    await browserFetch(page, 'GET', enableUrl);

    // ── Phase 6: Poll transcode ─────────────────────────────────────────
    const transResult = await pollTranscode(page, videoId);
    coverWidth = transResult.width;
    coverHeight = transResult.height;
    if (!coverUri) {
      coverUri = transResult.poster_uri;
    }

    // ── Phase 7: Content safety check ───────────────────────────────────
    if (!kwargs.no_safety_check) {
      const safetyUrl =
        'https://creator.douyin.com/aweme/v1/post_assistant/fast_detect/pre_check';
      const safetyBody = {
        video_id: videoId,
        title,
        desc: caption,
      };
      await browserFetch(page, 'POST', safetyUrl, { body: safetyBody });

      const pollUrl =
        'https://creator.douyin.com/aweme/v1/post_assistant/fast_detect/poll';
      const deadline = Date.now() + 30_000;
      let safetyPassed = false;
      while (Date.now() < deadline) {
        const pollRes = (await browserFetch(page, 'POST', pollUrl, {
          body: safetyBody,
        })) as { status: number };
        if (pollRes.status === 0) { safetyPassed = true; break; }
        if (pollRes.status === 1) {
          throw new CommandExecutionError(
            '内容安全检测不通过，请修改后重试',
            '使用 --no_safety_check 跳过',
          );
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (!safetyPassed) {
        throw new CommandExecutionError(
          '内容安全检测超时（30s），请稍后重试',
          '使用 --no_safety_check 跳过',
        );
      }
    }

    // ── Phase 8: create_v2 publish ──────────────────────────────────────
    const hashtagNames = extractHashtagNames(caption);
    const hashtags: HashtagInfo[] = [];
    let searchFrom = 0;
    for (const name of hashtagNames) {
      const idx = caption.indexOf(`#${name}`, searchFrom);
      if (idx === -1) continue;
      hashtags.push({ name, id: 0, start: idx, end: idx + name.length + 1 });
      searchFrom = idx + name.length + 1;
    }
    const textExtraArr = parseTextExtra(caption, hashtags);

    const publishBody = {
      item: {
        common: {
          text: caption,
          caption: '',
          item_title: title,
          activity: JSON.stringify(kwargs.activity ? [kwargs.activity] : []),
          text_extra: JSON.stringify(textExtraArr),
          challenges: '[]',
          mentions: '[]',
          hashtag_source: '',
          hot_sentence: (kwargs.hotspot as string) || '',
          interaction_stickers: '[]',
          visibility_type: visibilityType,
          download: kwargs.allow_download ? 1 : 0,
          timing: timingTs,
          creation_id: generateCreationId(),
          media_type: 4,
          video_id: videoId,
          music_source: 0,
          music_id: null,
          ...(kwargs.poi_id
            ? { poi_id: kwargs.poi_id as string, poi_name: kwargs.poi_name as string }
            : {}),
        },
        cover: {
          poster: coverUri,
          custom_cover_image_height: coverHeight,
          custom_cover_image_width: coverWidth,
          poster_delay: 0,
          cover_tools_info: DEFAULT_COVER_TOOLS_INFO,
          cover_tools_extend_info: '{}',
        },
        mix: kwargs.collection
          ? { mix_id: kwargs.collection as string, mix_order: 0 }
          : {},
        chapter: {
          chapter: JSON.stringify({
            chapter_abstract: '',
            chapter_details: [],
            chapter_type: 0,
          }),
        },
        anchor: {},
        sync: {
          should_sync: false,
          sync_to_toutiao: kwargs.sync_toutiao ? 1 : 0,
        },
        open_platform: {},
        assistant: { is_preview: 0, is_post_assistant: 1 },
        declare: { user_declare_info: '{}' },
      },
    };

    const publishUrl = `https://creator.douyin.com/web/api/media/aweme/create_v2/?read_aid=2906&${DEVICE_PARAMS}`;
    const publishRes = (await browserFetch(page, 'POST', publishUrl, {
      body: publishBody,
    })) as { status_code: number; aweme_id: string };

    const awemeId = publishRes.aweme_id;
    if (!awemeId) {
      throw new CommandExecutionError(`发布成功但未返回 aweme_id: ${JSON.stringify(publishRes)}`);
    }
    const url = `https://www.douyin.com/video/${awemeId}`;
    const publishTimeStr = new Date(timingTs * 1000).toLocaleString('zh-CN', {
      timeZone: 'Asia/Tokyo',
    });

    return [
      {
        status: '✅ 定时发布成功！',
        aweme_id: awemeId,
        url,
        publish_time: publishTimeStr,
      },
    ];
  },
});
