import * as fs from 'node:fs';
import * as path from 'node:path';

import { ArgumentError, CommandExecutionError } from '../../src/errors.js';
import { cli, Strategy } from '../../src/registry.js';
import type { IPage } from '../../src/types.js';
import {
  publishStoryViaPrivateApi,
  resolveInstagramPrivatePublishConfig,
} from './_shared/private-publish.js';
import { resolveInstagramRuntimeInfo } from './_shared/runtime-info.js';

const INSTAGRAM_HOME_URL = 'https://www.instagram.com/';
const SUPPORTED_STORY_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const SUPPORTED_STORY_VIDEO_EXTENSIONS = new Set(['.mp4']);

type InstagramStoryMediaItem = {
  type: 'image' | 'video';
  filePath: string;
};

type InstagramStorySuccessRow = {
  status: string;
  detail: string;
  url: string;
};

function requirePage(page: IPage | null): IPage {
  if (!page) throw new CommandExecutionError('Browser session required for instagram story');
  return page;
}

function validateInstagramStoryArgs(kwargs: Record<string, unknown>): void {
  if (kwargs.media === undefined) {
    throw new ArgumentError(
      'Argument "media" is required.',
      'Provide --media /path/to/file.jpg or --media /path/to/file.mp4',
    );
  }
}

function normalizeStoryMediaItem(kwargs: Record<string, unknown>): InstagramStoryMediaItem {
  const raw = String(kwargs.media ?? '').trim();
  const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw new ArgumentError(
      'Argument "media" is required.',
      'Provide --media /path/to/file.jpg or --media /path/to/file.mp4',
    );
  }
  if (parts.length > 1) {
    throw new ArgumentError(
      'Instagram story currently supports a single media item.',
      'Provide one image or one video path with --media',
    );
  }

  const resolved = path.resolve(parts[0]!);
  if (!fs.existsSync(resolved)) {
    throw new ArgumentError(`Story media file not found: ${resolved}`);
  }
  const ext = path.extname(resolved).toLowerCase();
  if (SUPPORTED_STORY_IMAGE_EXTENSIONS.has(ext)) {
    return { type: 'image', filePath: resolved };
  }
  if (SUPPORTED_STORY_VIDEO_EXTENSIONS.has(ext)) {
    return { type: 'video', filePath: resolved };
  }
  throw new ArgumentError(
    `Unsupported story media format: ${ext}`,
    'Supported formats: images (.jpg, .jpeg, .png, .webp) and videos (.mp4)',
  );
}

async function resolveCurrentUserId(page: IPage): Promise<string> {
  const cookies = await page.getCookies({ domain: 'instagram.com' });
  return cookies.find((cookie) => cookie.name === 'ds_user_id')?.value || '';
}

async function resolveCurrentUsername(page: IPage, currentUserId = ''): Promise<string> {
  if (!currentUserId) return '';
  const runtimeInfo = await resolveInstagramRuntimeInfo(page);
  const apiResult = await page.evaluate(`
    (async () => {
      const userId = ${JSON.stringify(currentUserId)};
      const appId = ${JSON.stringify(runtimeInfo.appId || '')};
      try {
        const res = await fetch(
          'https://www.instagram.com/api/v1/users/' + encodeURIComponent(userId) + '/info/',
          {
            credentials: 'include',
            headers: appId ? { 'X-IG-App-ID': appId } : {},
          },
        );
        if (!res.ok) return { ok: false };
        const data = await res.json();
        const username = data?.user?.username || '';
        return { ok: !!username, username };
      } catch {
        return { ok: false };
      }
    })()
  `) as { ok?: boolean; username?: string };

  return apiResult?.ok && apiResult.username ? apiResult.username : '';
}

function buildStorySuccessResult(mediaItem: InstagramStoryMediaItem, url: string): InstagramStorySuccessRow[] {
  return [{
    status: '✅ Posted',
    detail: mediaItem.type === 'video'
      ? 'Single video story shared successfully'
      : 'Single story shared successfully',
    url,
  }];
}

cli({
  site: 'instagram',
  name: 'story',
  description: 'Post a single Instagram story image or video',
  domain: 'www.instagram.com',
  strategy: Strategy.UI,
  browser: true,
  timeoutSeconds: 300,
  args: [
    { name: 'media', required: false, valueRequired: true, help: 'Path to a single story image or video file' },
  ],
  columns: ['status', 'detail', 'url'],
  validateArgs: validateInstagramStoryArgs,
  func: async (page: IPage | null, kwargs) => {
    const browserPage = requirePage(page);
    const mediaItem = normalizeStoryMediaItem(kwargs as Record<string, unknown>);
    const currentUserId = await resolveCurrentUserId(browserPage);
    const privateConfig = await resolveInstagramPrivatePublishConfig(browserPage);
    const storyResult = await publishStoryViaPrivateApi({
      page: browserPage,
      mediaItem,
      content: '',
      apiContext: privateConfig.apiContext,
      jazoest: privateConfig.jazoest,
      currentUserId,
    });
    const username = await resolveCurrentUsername(browserPage, currentUserId);
    const mediaPk = storyResult.mediaPk || storyResult.uploadId;
    const url = username && mediaPk
      ? new URL(`/stories/${username}/${mediaPk}/`, INSTAGRAM_HOME_URL).toString()
      : '';
    return buildStorySuccessResult(mediaItem, url);
  },
});
