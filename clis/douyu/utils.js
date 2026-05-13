import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

export const DOUYU_HOST = 'https://www.douyu.com';

export function normalizeRoom(input) {
  const raw = String(input || '').trim();
  if (!raw) {
    throw new ArgumentError('douyu room is required', 'Example: opencli douyu watch 6979222 -f yaml');
  }

  const match = raw.match(/(?:douyu\.com\/)?(?:room\/)?(\d{2,})/i);
  if (!match) {
    throw new ArgumentError(`Invalid Douyu room: ${raw}`, 'Use a numeric room id or a https://www.douyu.com/<room> URL');
  }

  return match[1];
}

export function buildRoomUrl(room) {
  return `${DOUYU_HOST}/${encodeURIComponent(normalizeRoom(room))}`;
}

export function requireText(value, label, maxLen = 50) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) {
    throw new ArgumentError(`${label} cannot be empty`);
  }
  if (text.length > maxLen) {
    throw new ArgumentError(`${label} is too long (${text.length} > ${maxLen})`);
  }
  return text;
}

export async function gotoRoom(page, room) {
  const roomId = normalizeRoom(room);
  const url = buildRoomUrl(roomId);
  await page.goto(url, { waitUntil: 'load', settleMs: 3000 });
  await page.wait({ time: 2 });
  return { roomId, url };
}

export async function ensureRoomReady(page) {
  const ready = await page.evaluate(`
    new Promise((resolve) => {
      const isReady = () => Boolean(
        document.querySelector('[class*="anchorInfo"]') ||
        document.querySelector('[class*="ChatSend"]') ||
        document.querySelector('[class*="followButton"]')
      );
      if (isReady()) return resolve(true);
      const observer = new MutationObserver(() => {
        if (isReady()) {
          observer.disconnect();
          resolve(true);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => {
        observer.disconnect();
        resolve(false);
      }, 8000);
    })
  `);
  if (!ready) {
    throw new CommandExecutionError('Douyu room did not finish rendering within 8s');
  }
}

export async function extractRoomSummary(page) {
  return page.evaluate(`
    (() => {
      const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const titleText = clean(
        document.querySelector('[class*="firstRowContainer"]')?.innerText ||
        document.querySelector('[class*="title"]')?.innerText ||
        ''
      );
      const subtitleText = clean(document.querySelector('[class*="subTitleContainer"]')?.innerText || '');
      const docTitle = clean(document.title || '');
      const streamerFromDoc = (docTitle.split('_')[1] || '').replace(/直播$/, '');
      const roomId = (location.pathname.match(/\\/(\\d+)/) || [])[1] || '';
      const followerText = clean(document.querySelector('[class*="followNum"]')?.innerText || '');
      const followerMatch = (followerText || titleText || '').match(/([\\d,.]+\\s*[万亿]?)(?:\\s*关注)?/);
      const title = titleText.replace(/\\s*[\\d,.]+\\s*[万亿]?\\s*关注.*/, '');
      const category = clean(document.querySelector('[class*="subTitleContainer"] a[href^="/g_"]')?.innerText || '');
      const bodyText = clean(document.body?.innerText || '');
      const videos = Array.from(document.querySelectorAll('video'));
      const video = videos.find((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 100 && rect.height > 80;
      }) || videos[0] || null;
      const hasVideo = Boolean(video);
      const videoPlaying = Boolean(video && !video.paused && !video.ended && video.readyState >= 2);
      const videoStreamReady = Boolean(video && !video.ended && video.readyState >= 2 && video.currentTime > 0);
      const offlineHint = /暂未开播|未开播|直播已结束|主播正在赶来|主播不在|休息中|已下播|房间不存在/.test(bodyText);
      const liveHint = /直播中|发送弹幕|弹幕礼仪|贵族|粉丝牌|开播/.test(bodyText);
      const liveStatus = videoPlaying || videoStreamReady || (hasVideo && liveHint && !offlineHint)
        ? 'live'
        : offlineHint
          ? 'offline'
          : 'unknown';
      const liveStatusReason = videoPlaying
        ? 'video-playing'
        : videoStreamReady
          ? 'video-stream-ready'
        : hasVideo && liveHint && !offlineHint
          ? 'video-present-live-text'
          : offlineHint
            ? 'offline-text'
            : 'no-strong-signal';

      return {
        room: roomId,
        title: title || docTitle.split('_')[0] || '',
        streamer: streamerFromDoc || subtitleText.replace(/\\s+\\d+.*/, ''),
        category,
        followers: followerMatch ? followerMatch[1] : '',
        live_status: liveStatus,
        live_status_reason: liveStatusReason,
        video_status: hasVideo
          ? \`video:\${video.paused ? 'paused' : 'playing'}:\${Math.floor(video.currentTime || 0)}s:ready\${video.readyState}\`
          : 'video:not-found',
        url: location.href,
      };
    })()
  `);
}

export function wrapUiWriteError(error, action) {
  const message = error instanceof Error ? error.message : String(error);
  if (/login|登录|AUTH_REQUIRED/i.test(message)) {
    throw new AuthRequiredError('www.douyu.com', `Douyu login is required to ${action}`);
  }
  throw new CommandExecutionError(`Failed to ${action}: ${message}`);
}
