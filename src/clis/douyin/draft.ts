/**
 * Douyin draft — 6-phase pipeline for saving video as draft.
 *
 * Phases:
 *   1. STS2 credentials
 *   2. Apply TOS upload URL
 *   3. TOS multipart upload
 *   4. Cover upload (optional, via ImageX)
 *   5. Enable video
 *   6. Poll transcode
 *   7. (skipped — no safety check for drafts)
 *   8. create_v2 with is_draft: 1
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
  name: 'draft',
  description: '上传视频并保存为草稿',
  domain: 'creator.douyin.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'video', required: true, positional: true, help: '视频文件路径' },
    { name: 'title', required: true, help: '视频标题（≤30字）' },
    { name: 'caption', default: '', help: '正文内容（≤1000字，支持 #话题）' },
    { name: 'cover', default: '', help: '封面图片路径' },
    { name: 'visibility', default: 'public', choices: ['public', 'friends', 'private'] },
  ],
  columns: ['status', 'aweme_id'],
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

    // ── Phase 7: SKIP (no safety check for drafts) ──────────────────────

    // ── Phase 8: create_v2 with is_draft: 1 ────────────────────────────
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
          activity: '[]',
          text_extra: JSON.stringify(textExtraArr),
          challenges: '[]',
          mentions: '[]',
          hashtag_source: '',
          hot_sentence: '',
          interaction_stickers: '[]',
          visibility_type: visibilityType,
          download: 0,
          is_draft: 1,
          creation_id: generateCreationId(),
          media_type: 4,
          video_id: videoId,
          music_source: 0,
          music_id: null,
        },
        cover: {
          poster: coverUri,
          custom_cover_image_height: coverHeight,
          custom_cover_image_width: coverWidth,
          poster_delay: 0,
          cover_tools_info: DEFAULT_COVER_TOOLS_INFO,
          cover_tools_extend_info: '{}',
        },
        mix: {},
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
          sync_to_toutiao: 0,
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
      throw new CommandExecutionError(`草稿保存成功但未返回 aweme_id: ${JSON.stringify(publishRes)}`);
    }

    return [
      {
        status: '✅ 草稿保存成功！',
        aweme_id: awemeId,
      },
    ];
  },
});
