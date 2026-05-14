import { CommandExecutionError } from '@jackwener/opencli/errors';
import { DOUYU_HOST } from './utils.js';

export const DOUYU_VIDEO_HOST = 'https://v.douyu.com';
export const DEFAULT_VIDEO_SOURCE = `${DOUYU_VIDEO_HOST}/video/videotag/list?tagId=15`;

function unwrapArray(result) {
  return Array.isArray(result) ? result : Array.isArray(result?.data) ? result.data : [];
}

function unwrapObject(result) {
  return result && typeof result === 'object' && 'data' in result
    ? result.data
    : result;
}

function buildVideoPickerScript(limit) {
  return `
    (() => {
      const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const parseDuration = (text) => {
        const matches = Array.from(String(text || '').matchAll(/(?:^|\\s)(\\d{1,3}):(\\d{2})(?::(\\d{2}))?(?:\\s|$)/g));
        if (matches.length === 0) return 0;
        const match = matches[matches.length - 1];
        return match[3]
          ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
          : Number(match[1]) * 60 + Number(match[2]);
      };
      const titleFromText = (text) => clean(String(text || '')
        .replace(/^\\d+(?:\\.\\d+)?万?\\s+\\d+\\s+\\d{1,3}:\\d{2}(?::\\d{2})?\\s+/, '')
        .replace(/\\d+(?:\\.\\d+)?万?播放.*/, '')
      ).slice(0, 120);
      const seen = new Map();
      const visit = (root) => {
        for (const a of root.querySelectorAll('a[href*="/show/"], demand-router-link[href*="/show/"]')) {
          const rawHref = a.href || a.getAttribute('href') || '';
          let href = '';
          try {
            href = new URL(rawHref, location.href).href.replace(/#.*$/, '');
          } catch {
            continue;
          }
          const match = href.match(/\\/show\\/([A-Za-z0-9]+)/);
          if (!match) continue;
          const card = a.closest('li, demand-card, div') || a.parentElement || a;
          const text = clean(card.innerText || card.textContent || a.innerText || a.textContent || a.getAttribute('title') || '');
          const prev = seen.get(match[1]) || {};
          const duration = parseDuration(text) || prev.duration || 0;
          seen.set(match[1], {
            id: match[1],
            url: href,
            title: prev.title || a.getAttribute('title') || titleFromText(text),
            duration_seconds: duration,
            duration: duration > 0 ? String(Math.floor(duration / 60)).padStart(2, '0') + ':' + String(duration % 60).padStart(2, '0') : '',
            text: prev.text || text.slice(0, 180),
          });
        }
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) visit(el.shadowRoot);
        }
      };
      visit(document);
      return Array.from(seen.values())
        .filter((item) => item.url && item.id)
        .sort((a, b) => (b.duration_seconds || 0) - (a.duration_seconds || 0))
        .slice(0, ${Number(limit) || 120});
    })()
  `;
}

function buildPickerDebugScript() {
  return `
    (() => {
      const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const anchors = Array.from(document.querySelectorAll('a[href], demand-router-link[href]'));
      return Object.assign(Object.create(null), {
        url: location.href,
        title: document.title || '',
        anchor_count: anchors.length,
        show_like_hrefs: anchors
          .map((a) => Object.assign(Object.create(null), { href: a.href || a.getAttribute('href') || '', text: clean(a.innerText || a.textContent || '').slice(0, 100) }))
          .filter((item) => /\\/show\\//.test(item.href))
          .slice(0, 12),
        body: clean(document.body?.innerText || '').slice(0, 260),
      });
    })()
  `;
}

function buildVideoStatusScript({ attemptPlay = true } = {}) {
  return `
    (async () => {
      const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const findVideos = (root, out = []) => {
        for (const el of root.querySelectorAll('*')) {
          if (el.tagName === 'VIDEO') out.push(el);
          if (el.shadowRoot) findVideos(el.shadowRoot, out);
        }
        return out;
      };
      const videos = findVideos(document);
      const video = videos.find((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 100 && rect.height > 80;
      }) || videos[0] || null;
      let play_error = '';
      let play_attempted = false;

      if (video && ${attemptPlay ? 'true' : 'false'}) {
        try {
          if (video.paused || video.ended || video.readyState < 2) {
            await video.play();
            play_attempted = true;
            await sleep(600);
          }
        } catch (error) {
          play_error = error?.message || String(error);
        }
      }

      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 36, clientY: 36 }));
      window.dispatchEvent(new Event('focus'));

      const bodyText = clean(document.body?.innerText || '');
      return Object.assign(Object.create(null), {
        url: location.href,
        title: document.title || '',
        has_video: Boolean(video),
        paused: video ? Boolean(video.paused) : null,
        ended: video ? Boolean(video.ended) : null,
        ready_state: video ? video.readyState : null,
        current_time: video ? Math.floor(video.currentTime || 0) : null,
        duration_seconds: video && Number.isFinite(video.duration) ? Math.floor(video.duration || 0) : 0,
        play_attempted,
        play_error,
        page_hidden: document.hidden,
        body_hint: bodyText.slice(0, 160),
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
          if (text.length < 2 || text.length > 700) return false;
          const highLayer = ['fixed', 'absolute', 'sticky'].includes(style.position) || Number(style.zIndex || 0) > 1;
          const nearAvatar = rect.top < 300 && rect.right > window.innerWidth * 0.45;
          const taskText = /经验|任务|亲密度|鱼丸|签到|等级|弹幕|关注|观看|视频|领取|已完成|每日/.test(text);
          return taskText && (highLayer || nearAvatar);
        })
        .map((el) => clean(el.innerText || el.textContent || ''))
        .filter(Boolean)
        .slice(0, 10);

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
        evidence: text.slice(0, 380),
      };
    })()
  `;
}

function pickBestVideo(videos, targetSeconds, seenUrls) {
  const unseen = videos.filter((item) => item.url && !seenUrls.has(item.url));
  const withDuration = unseen.filter((item) => Number(item.duration_seconds || 0) > 0);
  const longEnough = withDuration.filter((item) => Number(item.duration_seconds) >= targetSeconds + 30);
  const pool = longEnough.length > 0
    ? longEnough
    : withDuration.length > 0
      ? withDuration
      : unseen;
  if (pool.length === 0) return null;
  const top = pool
    .sort((a, b) => Number(b.duration_seconds || 0) - Number(a.duration_seconds || 0))
    .slice(0, Math.min(pool.length, 20));
  return top[Math.floor(Math.random() * top.length)];
}

async function pickVideoFromSource(page, kwargs, targetSeconds, seenUrls) {
  const sourceUrl = kwargs['video-source'] || DEFAULT_VIDEO_SOURCE;
  const poolLimit = Math.max(1, Math.min(Number(kwargs['video-pool'] || 120), 300));
  await page.goto(sourceUrl, { waitUntil: 'load', settleMs: 3000 });
  await page.wait({ time: 2 });

  const merged = new Map();
  for (let i = 0; i < 8; i++) {
    if (i > 0) {
      await page.autoScroll({ times: 1, delayMs: 600 });
      await page.evaluate(`
        (() => {
          window.scrollBy(0, Math.max(window.innerHeight * 0.9, 700));
          document.scrollingElement?.scrollBy?.(0, Math.max(window.innerHeight * 0.9, 700));
        })()
      `);
      await page.wait({ time: 1 });
    }
    const result = await page.evaluate(buildVideoPickerScript(poolLimit));
    for (const item of unwrapArray(result)) {
      const prev = merged.get(item.url) || {};
      merged.set(item.url, {
        ...prev,
        ...item,
        duration_seconds: Number(item.duration_seconds || prev.duration_seconds || 0),
      });
    }
    const videos = Array.from(merged.values());
    const hasTimedCandidates = videos.some((item) => Number(item.duration_seconds || 0) > 0 && !seenUrls.has(item.url));
    if (hasTimedCandidates || i === 7) {
      const picked = pickBestVideo(videos, targetSeconds, seenUrls);
      if (picked && (hasTimedCandidates || i === 7)) return { ...picked, pool_size: videos.length };
    }
  }

  const debug = await page.evaluate(buildPickerDebugScript());
  throw new CommandExecutionError(`No Douyu videos found from video source page: ${JSON.stringify(debug)}`);
}

async function ensureVideoPlaying(page) {
  let status = unwrapObject(await page.evaluate(buildVideoStatusScript({ attemptPlay: true })));
  if (!status?.has_video) {
    await page.wait({ time: 2 });
    status = unwrapObject(await page.evaluate(buildVideoStatusScript({ attemptPlay: true })));
  }
  if (status?.has_video && status.paused) {
    await page.click('demand-video');
    await page.wait({ time: 2 });
    status = unwrapObject(await page.evaluate(buildVideoStatusScript({ attemptPlay: true })));
  }
  if (!status?.has_video) {
    throw new CommandExecutionError(`Douyu video element not found: ${JSON.stringify(status)}`);
  }
  if (status.paused || status.ended) {
    throw new CommandExecutionError(`Douyu video did not start playing: ${JSON.stringify(status)}`);
  }
  return status;
}

async function watchCurrentVideo(page, remainingSeconds, intervalSeconds) {
  const interval = Math.max(5, Math.min(Number(intervalSeconds ?? 20), 120));
  const wallDeadline = Date.now() + Math.max(remainingSeconds * 3, remainingSeconds + 180) * 1000;
  let watchedSeconds = 0;
  let checks = 0;
  let activeChecks = 0;
  let failedChecks = 0;
  let lastCurrentTime = null;
  let last = null;

  while (watchedSeconds < remainingSeconds && Date.now() < wallDeadline) {
    last = unwrapObject(await page.evaluate(buildVideoStatusScript({ attemptPlay: true })));
    checks += 1;

    const currentTime = Number(last?.current_time ?? 0);
    const delta = lastCurrentTime === null ? 0 : currentTime - lastCurrentTime;
    const timeAdvanced = delta > 0 && delta <= interval + 5;
    const playing = Boolean(last?.has_video) && !last.paused && !last.ended && (last.ready_state === null || last.ready_state >= 2);

    if (timeAdvanced) {
      watchedSeconds += Math.min(delta, interval);
    }
    if (playing || timeAdvanced) {
      activeChecks += 1;
      failedChecks = 0;
    } else {
      failedChecks += 1;
      if (failedChecks >= 2 && last?.has_video) {
        await page.click('demand-video');
      }
    }

    lastCurrentTime = currentTime;
    if (last?.ended) break;
    if (checks >= 3 && failedChecks >= 3) break;

    const remaining = remainingSeconds - watchedSeconds;
    if (remaining <= 0) break;
    await page.wait({ time: Math.min(interval, Math.ceil(remaining)) });
  }

  return {
    watched_seconds: Math.floor(watchedSeconds),
    checks,
    active_checks: activeChecks,
    ended: Boolean(last?.ended),
    failed: watchedSeconds < remainingSeconds && failedChecks >= 3,
    video_status: last ? (
      last.has_video
        ? `video:${last.paused ? 'paused' : 'playing'}:${last.current_time ?? 0}s/${last.duration_seconds || 0}s`
        : 'video:not-found'
    ) : 'not-checked',
  };
}

async function verifyVideoTask(page, strictVerify) {
  await page.goto(DOUYU_HOST, { waitUntil: 'load', settleMs: 3000 });
  await page.wait({ time: 2 });
  const result = unwrapObject(await page.evaluate(buildTaskVerificationScript()));
  const hints = result.completion_hints.join(',') || 'task-panel-visible';
  const specific = /观看|视频/.test(`${hints},${result.evidence || ''}`);
  const status = result.panel_visible
    ? specific
      ? `verified:${hints}`
      : `panel-visible:${hints}`
    : 'verification:inconclusive';
  if (strictVerify && !result.panel_visible) {
    throw new CommandExecutionError('Douyu task verification panel did not appear from avatar hover');
  }
  return { ...result, status };
}

export async function runVideoWatchTask(page, kwargs) {
  const targetSeconds = Math.max(0, Math.min(Number(kwargs['video-watch-minutes'] ?? 15) * 60, 4 * 60 * 60));
  const checkInterval = Math.max(5, Math.min(Number(kwargs['video-check-interval'] ?? 20), 120));
  const maxVideos = Math.max(1, Math.min(Number(kwargs['max-videos'] ?? 5), 20));
  const seenUrls = new Set();
  const watchedVideos = [];
  let totalWatched = 0;
  let lastUrl = '';

  if (targetSeconds === 0) {
    return {
      videos: '',
      watch: 'skipped',
      verification: 'skipped',
      verification_evidence: '',
      status: 'skipped; video-watch-minutes is 0',
      url: '',
    };
  }

  while (totalWatched < targetSeconds && watchedVideos.length < maxVideos) {
    const remaining = Math.max(0, targetSeconds - totalWatched);
    const picked = await pickVideoFromSource(page, kwargs, remaining || targetSeconds || 60, seenUrls);
    seenUrls.add(picked.url);
    lastUrl = picked.url;

    await page.goto(picked.url, { waitUntil: 'load', settleMs: 3000 });
    await page.wait({ time: 3 });

    if (kwargs['dry-run']) {
      return {
        videos: `${picked.title || picked.id} (${picked.duration || `${picked.duration_seconds || 0}s`})`,
        watch: 'dry-run',
        verification: 'dry-run',
        verification_evidence: '',
        status: `picked from ${picked.pool_size} videos`,
        url: picked.url,
      };
    }

    await ensureVideoPlaying(page);
    const segment = await watchCurrentVideo(page, remaining, checkInterval);
    totalWatched += segment.watched_seconds;
    watchedVideos.push(`${picked.title || picked.id}:${segment.watched_seconds}s:${segment.video_status}`);
    lastUrl = unwrapObject(await page.evaluate('(() => location.href)()')) || picked.url;

    if (totalWatched >= targetSeconds) break;
    if (segment.failed && !segment.ended) {
      continue;
    }
  }

  if (totalWatched < targetSeconds) {
    throw new CommandExecutionError(`Only accumulated ${totalWatched}s of Douyu video playback, target ${targetSeconds}s`);
  }

  const verification = kwargs.verify ? await verifyVideoTask(page, kwargs['strict-verify']) : null;

  return {
    videos: watchedVideos.join(' | '),
    watch: `video-progress:${Math.floor(totalWatched)}s`,
    verification: verification?.status || 'skipped',
    verification_evidence: verification?.evidence || '',
    status: `done; watched ${Math.floor(totalWatched)}s across ${watchedVideos.length} video(s)`,
    url: lastUrl,
  };
}

export const __test__ = { buildVideoPickerScript, buildVideoStatusScript, buildTaskVerificationScript, pickBestVideo };
