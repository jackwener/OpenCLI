import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { DOUYU_HOST, extractRoomSummary, requireText } from './utils.js';
import { followRoom } from './follow.js';
import { sendDanmaku } from './danmaku.js';
import { DEFAULT_VIDEO_SOURCE, runVideoWatchTask } from './video-task.js';

function buildRoomPickerScript(limit) {
  return `
    (() => {
      const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const seen = new Map();
      for (const a of document.querySelectorAll('a[href]')) {
        const href = a.getAttribute('href') || a.href || '';
        const match = href.match(/(?:^\\/|douyu\\.com\\/)(\\d{2,})(?:[?#]|$)/);
        if (!match) continue;

        const room = match[1];
        const prev = seen.get(room) || {};
        const text = clean(a.innerText || a.getAttribute('title') || '');
        if (/我的关注|浏览历史|排行榜|全部分类/.test(text) && !/已开播|\\d+(?:\\.\\d+)?万/.test(text)) continue;
        seen.set(room, {
          room,
          title: prev.title || a.getAttribute('title') || text,
          text: prev.text || text,
          url: ${JSON.stringify(DOUYU_HOST)} + '/' + room,
        });
      }
      return Array.from(seen.values())
        .filter((item) => item.room && item.room !== '0')
        .slice(0, ${Number(limit) || 80});
    })()
  `;
}

function buildRoomPickerDebugScript() {
  return `
    (() => {
      const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      return Object.assign(Object.create(null), {
        url: location.href,
        title: document.title || '',
        anchor_count: anchors.length,
        room_like_hrefs: anchors
          .map((a) => Object.assign(Object.create(null), { href: a.getAttribute('href') || '', text: clean(a.innerText || a.textContent || '').slice(0, 80) }))
          .filter((item) => /(?:^\\/|douyu\\.com\\/)(\\d{2,})(?:[?#]|$)/.test(item.href))
          .slice(0, 8),
        body: clean(document.body?.innerText || '').slice(0, 240),
      });
    })()
  `;
}

async function pickRandomRoom(page, kwargs) {
  const sourceUrl = kwargs.source || `${DOUYU_HOST}/directory/all`;
  const poolLimit = Math.max(1, Math.min(Number(kwargs.pool || 80), 200));
  await page.goto(sourceUrl, { waitUntil: 'load', settleMs: 3000 });
  await page.wait({ time: 2 });
  await page.autoScroll({ times: 2, delayMs: 800 });

  let rooms = [];
  for (let i = 0; i < 15; i++) {
    const result = await page.evaluate(buildRoomPickerScript(poolLimit));
    rooms = Array.isArray(result) ? result : Array.isArray(result?.data) ? result.data : [];
    if (Array.isArray(rooms) && rooms.length > 0) break;
    await page.wait({ time: 1 });
    await page.autoScroll({ times: 1, delayMs: 300 });
  }
  if (!Array.isArray(rooms) || rooms.length === 0) {
    const debug = await page.evaluate(buildRoomPickerDebugScript());
    throw new CommandExecutionError(`No live Douyu rooms found from directory page: ${JSON.stringify(debug)}`);
  }

  const index = Math.floor(Math.random() * rooms.length);
  return { ...rooms[index], pool_size: rooms.length };
}

function buildKeepAliveScript() {
  return `
    (async () => {
      const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const videos = Array.from(document.querySelectorAll('video'));
      const video = videos.find((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 100 && rect.height > 80;
      }) || videos[0];

      let play_attempted = false;
      if (video) {
        try {
          if (video.paused || video.ended || video.readyState < 2) {
            await video.play();
            play_attempted = true;
          }
        } catch {
          const rect = video.getBoundingClientRect();
          const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          (target || video).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          await sleep(500);
          try {
            await video.play();
            play_attempted = true;
          } catch {}
        }
      }

      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 32, clientY: 32 }));
      window.dispatchEvent(new Event('focus'));
      if (document.hidden && document.title) {
        document.title = document.title;
      }

      const bodyText = clean(document.body?.innerText || '');
      return Object.assign(Object.create(null), {
        url: location.href,
        title: document.title || '',
        has_video: Boolean(video),
        paused: video ? Boolean(video.paused) : null,
        ended: video ? Boolean(video.ended) : null,
        ready_state: video ? video.readyState : null,
        current_time: video ? Math.floor(video.currentTime || 0) : null,
        play_attempted,
        page_hidden: document.hidden,
        live_hint: bodyText.includes('直播中') || bodyText.includes('已播'),
      });
    })()
  `;
}

function buildTaskVerificationScript() {
  return `
    (async () => {
      const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const isVisible = (el) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const dispatchHover = (el) => {
        const rect = el.getBoundingClientRect();
        const x = Math.max(1, Math.min(window.innerWidth - 1, rect.left + rect.width / 2));
        const y = Math.max(1, Math.min(window.innerHeight - 1, rect.top + rect.height / 2));
        for (const type of ['pointerover', 'mouseover', 'mouseenter', 'mousemove']) {
          el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }));
        }
      };
      const findAvatar = () => {
        const selectors = [
          '.avatar-img',
          '.avarta-img',
          '[class*="avatar-img"]',
          '[class*="avarta-img"]',
          '[class*="Avatar"] img',
          '[class*="avatar"] img',
          'img[src*="avatar"]',
        ];
        const candidates = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
        return candidates.find((el) => {
          if (!isVisible(el)) return false;
          const rect = el.getBoundingClientRect();
          return rect.top < 140 && rect.left > window.innerWidth * 0.45;
        }) || candidates.find(isVisible) || null;
      };
      const collectPanels = () => Array.from(document.querySelectorAll('body *'))
        .filter((el) => {
          if (!isVisible(el)) return false;
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          const text = clean(el.innerText || el.textContent || '');
          if (text.length < 2 || text.length > 500) return false;
          const highLayer = ['fixed', 'absolute', 'sticky'].includes(style.position) || Number(style.zIndex || 0) > 1;
          const nearAvatar = rect.top < 260 && rect.right > window.innerWidth * 0.45;
          const taskText = /经验|任务|亲密度|鱼丸|签到|等级|弹幕|关注|观看|视频|领取|已完成|每日/.test(text);
          return taskText && (highLayer || nearAvatar);
        })
        .map((el) => clean(el.innerText || el.textContent || ''))
        .filter(Boolean)
        .slice(0, 8);

      const avatar = findAvatar();
      if (avatar) {
        dispatchHover(avatar);
        await sleep(1200);
      }

      let panels = collectPanels();
      if (panels.length === 0 && avatar) {
        avatar.click();
        await sleep(1200);
        panels = collectPanels();
      }

      const text = panels.join(' | ');
      const completionHints = Array.from(new Set(text.match(/已完成|完成|已领取|今日已|经验\\s*\\+?\\d*|亲密度\\s*\\+?\\d*|弹幕|关注|观看|视频/g) || []));
      return {
        has_avatar: Boolean(avatar),
        panel_visible: panels.length > 0,
        completion_hints: completionHints,
        evidence: text.slice(0, 300),
      };
    })()
  `;
}

async function keepWatching(page, minutes, intervalSeconds) {
  const totalSeconds = Math.max(0, Math.min(Number(minutes ?? 40) * 60, 8 * 60 * 60));
  const interval = Math.max(10, Math.min(Number(intervalSeconds ?? 30), 300));
  const deadline = Date.now() + totalSeconds * 1000;
  let checks = 0;
  let playingChecks = 0;
  let failedChecks = 0;
  let lastCurrentTime = null;
  let last = null;

  while (Date.now() < deadline) {
    last = await page.evaluate(buildKeepAliveScript());
    checks += 1;
    const currentTime = Number(last?.current_time ?? 0);
    const timeAdvanced = lastCurrentTime !== null && currentTime > lastCurrentTime;
    const playing = Boolean(last?.has_video) && !last.paused && !last.ended && (last.ready_state === null || last.ready_state >= 2);
    if (playing || timeAdvanced) {
      playingChecks += 1;
      failedChecks = 0;
    } else {
      failedChecks += 1;
    }
    lastCurrentTime = currentTime;
    if (checks >= 3 && failedChecks >= 3) {
      throw new CommandExecutionError('Douyu video playback could not be kept alive for 3 consecutive checks');
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await page.wait({ time: Math.min(interval, Math.ceil(remainingMs / 1000)) });
  }

  if (totalSeconds > 0 && playingChecks === 0) {
    throw new CommandExecutionError('Douyu video playback was never confirmed as active');
  }

  return {
    watched_seconds: totalSeconds,
    checks,
    playing_checks: playingChecks,
    video_status: last ? (
      last.has_video
        ? `video:${last.paused ? 'paused' : 'playing'}:${last.current_time ?? 0}s`
        : 'video:not-found'
    ) : 'not-checked',
  };
}

async function verifyDailyTask(page, strictVerify) {
  await page.goto(DOUYU_HOST, { waitUntil: 'load', settleMs: 3000 });
  await page.wait({ time: 2 });
  const result = await page.evaluate(buildTaskVerificationScript());
  const status = result.panel_visible
    ? `verified:${result.completion_hints.join(',') || 'task-panel-visible'}`
    : 'verification:inconclusive';
  if (strictVerify && !result.panel_visible) {
    throw new CommandExecutionError('Douyu daily task verification panel did not appear from avatar hover');
  }
  return { ...result, status };
}

export const command = cli({
  site: 'douyu',
  name: 'daily-task',
  aliases: ['task'],
  description: '随机打开斗鱼直播间完成关注、弹幕、直播观看和视频观看每日任务',
  access: 'write',
  example: 'opencli douyu daily-task --window foreground --keep-tab true -f yaml',
  domain: 'www.douyu.com',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  args: [
    { name: 'message1', default: '打卡', help: 'First danmaku text, max 50 chars' },
    { name: 'message2', default: '主播加油', help: 'Second danmaku text, max 50 chars' },
    { name: 'source', default: `${DOUYU_HOST}/directory/all`, help: 'Directory/category URL used as the random room source' },
    { name: 'pool', type: 'int', default: 80, help: 'Maximum candidate rooms to sample from' },
    { name: 'delay', type: 'int', default: 3, help: 'Seconds to wait between the two danmaku messages' },
    { name: 'watch-minutes', type: 'int', default: 40, help: 'Minutes to keep the selected live room playing after task actions' },
    { name: 'check-interval', type: 'int', default: 30, help: 'Seconds between playback keepalive checks' },
    { name: 'video-source', default: DEFAULT_VIDEO_SOURCE, help: 'Douyu video listing URL used as the video source' },
    { name: 'video-pool', type: 'int', default: 120, help: 'Maximum candidate videos to sample from' },
    { name: 'video-watch-minutes', type: 'int', default: 15, help: 'Minutes of actual video playback progress to accumulate after live watching' },
    { name: 'video-check-interval', type: 'int', default: 20, help: 'Seconds between video playback progress checks' },
    { name: 'max-videos', type: 'int', default: 5, help: 'Maximum videos to use if shorter videos end before target time' },
    { name: 'timeout', type: 'int', default: 3900, help: 'Runtime timeout in seconds; must exceed live and video watch time' },
    { name: 'verify', type: 'bool', default: true, help: 'Hover account avatar and collect task/experience evidence after watching' },
    { name: 'strict-verify', type: 'bool', default: true, help: 'Fail when the task/experience panel cannot be verified' },
    { name: 'dry-run', type: 'bool', default: false, help: 'Only choose and open the room; do not follow or send danmaku' },
  ],
  columns: ['room', 'streamer', 'title', 'follow_result', 'danmaku1', 'danmaku2', 'live_watch', 'video_watch', 'videos', 'verification', 'verification_evidence', 'status', 'url'],
  func: async (page, kwargs) => {
    const message1 = requireText(kwargs.message1, 'message1', 50);
    const message2 = requireText(kwargs.message2, 'message2', 50);
    const delay = Math.max(0, Math.min(Number(kwargs.delay ?? 3), 30));
    const watchMinutes = Math.max(0, Math.min(Number(kwargs['watch-minutes'] ?? 40), 480));
    const checkInterval = Math.max(10, Math.min(Number(kwargs['check-interval'] ?? 30), 300));
    const picked = await pickRandomRoom(page, kwargs);

    await page.goto(picked.url, { waitUntil: 'load', settleMs: 3000 });
    await page.wait({ time: 2 });
    const summary = await extractRoomSummary(page);

    if (kwargs['dry-run']) {
      return [{
        room: summary.room || picked.room,
        streamer: summary.streamer,
        title: summary.title || picked.title,
        follow_result: 'dry-run',
        danmaku1: 'dry-run',
        danmaku2: 'dry-run',
        live_watch: 'dry-run',
        video_watch: 'dry-run',
        videos: '',
        verification: 'dry-run',
        verification_evidence: '',
        status: `picked from ${picked.pool_size} rooms`,
        url: summary.url || picked.url,
      }];
    }

    const followRows = await followRoom(page, picked.room);
    const firstRows = await sendDanmaku(page, picked.room, message1);
    if (delay > 0) {
      await page.wait({ time: delay });
    }
    const secondRows = await sendDanmaku(page, picked.room, message2);
    const watchResult = await keepWatching(page, watchMinutes, checkInterval);
    const videoResult = await runVideoWatchTask(page, { ...kwargs, verify: false });
    const verification = kwargs.verify ? await verifyDailyTask(page, kwargs['strict-verify']) : null;

    return [{
      room: summary.room || picked.room,
      streamer: summary.streamer,
      title: summary.title || picked.title,
      follow_result: followRows?.[0]?.result || '',
      danmaku1: firstRows?.[0]?.result || '',
      danmaku2: secondRows?.[0]?.result || '',
      live_watch: watchResult.video_status,
      video_watch: videoResult.watch,
      videos: videoResult.videos,
      verification: verification?.status || 'skipped',
      verification_evidence: verification?.evidence || '',
      status: `done; live watched ${watchResult.watched_seconds}s with ${watchResult.playing_checks}/${watchResult.checks} active checks; ${videoResult.status}`,
      url: videoResult.url || summary.url || picked.url,
    }];
  },
});

export const __test__ = { buildRoomPickerScript, buildRoomPickerDebugScript, buildKeepAliveScript, buildTaskVerificationScript };
