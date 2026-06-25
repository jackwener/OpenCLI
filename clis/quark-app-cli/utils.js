import { cli, Strategy } from '@jackwener/opencli/registry';

export const SITE = 'quark-app-cli';
export const DISPLAY_NAME = 'QuarkCloudDrive';

process.env.OPENCLI_CDP_TARGET ??= '首页';

export const TAB_ALIASES = {
  video: ['video', 'shipin', 'media', 'play', '播放', '视频'],
  summary: ['summary', 'ai-summary', 'ai_summary', 'ai总结', 'AI总结', '总结'],
  transcript: ['transcript', 'script', 'doc', 'docs', 'wen稿', '文稿', '稿件'],
  courseware: ['courseware', 'slides', 'ppt', 'ai-courseware', 'ai_courseware', 'AI课件', 'ai课件', '课件'],
};

export const TAB_LABELS = {
  video: '视频',
  summary: 'AI总结',
  transcript: '文稿',
  courseware: 'AI课件',
};

export const PLAYER_TAB_KEYS = {
  video: 'video',
  summary: 'summary_tab',
  transcript: 'transcription',
  courseware: 'courseware',
};

export function normalizeTabName(input) {
  const raw = String(input ?? '').trim();
  const folded = raw.toLowerCase().replace(/\s+/g, '').replace(/_/g, '-');
  for (const [key, aliases] of Object.entries(TAB_ALIASES)) {
    if (key === folded || aliases.some((alias) => alias.toLowerCase().replace(/\s+/g, '').replace(/_/g, '-') === folded)) {
      return key;
    }
  }
  throw new Error(`Unknown tab "${raw}". Use one of: video, summary, transcript, courseware`);
}

export function makeUiCommand(opts) {
  return cli({
    site: SITE,
    access: 'read',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    timeoutSeconds: 30,
    ...opts,
  });
}

export async function getWindowInfo(page) {
  return page.evaluate(`
    (() => {
      const bodyText = (document.body?.innerText || '').replace(/\\s+/g, ' ').trim();
      return {
        url: location.href,
        title: document.title,
        readyState: document.readyState,
        bodyPreview: bodyText.slice(0, 240),
      };
    })()
  `);
}

export async function findTabCandidates(page) {
  return page.evaluate(`
    (() => {
      const wanted = ${JSON.stringify(Object.values(TAB_LABELS))};
      const isVisible = (el) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.visibility !== 'hidden'
          && style.display !== 'none'
          && rect.width > 0
          && rect.height > 0;
      };
      const shortText = (el) => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
      const candidates = [];
      for (const el of document.querySelectorAll('button,[role="tab"],[role="button"],a,div,span')) {
        if (!isVisible(el)) continue;
        const text = shortText(el);
        if (!wanted.includes(text)) continue;
        const rect = el.getBoundingClientRect();
        candidates.push({
          label: text,
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute('role') || '',
          className: String(el.className || ''),
          selected: el.getAttribute('aria-selected') === 'true'
            || el.getAttribute('aria-current') === 'page'
            || /(^|\\s)(active|selected|current|is-active)(\\s|$)/i.test(String(el.className || '')),
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      }
      if (new Set(candidates.map((item) => item.label)).size < 2) return [];
      return candidates;
    })()
  `);
}

export async function clickVideoTab(page, targetName) {
  const tab = normalizeTabName(targetName);
  const label = TAB_LABELS[tab];
  const lastVideo = await page.evaluate(`
    (() => window.__OPENCLI_LAST_VIDEO__ || null)()
  `);
  if (lastVideo?.originalFid || lastVideo?.fid) {
    const opened = await openQuarkVideo(page, lastVideo.originalFid || lastVideo.fid, tab);
    return {
      Status: 'OpenedTab',
      Tab: tab,
      Label: label,
      Target: `native-player:${opened.TargetTab || PLAYER_TAB_KEYS[tab]}`,
      Position: 'bridge',
    };
  }
  throw new Error(`No remembered Quark video. Run "opencli quark-app-cli open-video <name-or-fid>" first. Mouse-event tab clicks are disabled for this adapter.`);
}

export async function openQuarkVideo(page, input, targetTab = '') {
  const normalizedTab = targetTab ? normalizeTabName(targetTab) : '';
  const playerTab = normalizedTab ? PLAYER_TAB_KEYS[normalizedTab] : '';
  const result = await page.evaluate(`
    (async () => {
      const input = ${JSON.stringify(String(input ?? '').trim())};
      const playerTab = ${JSON.stringify(playerTab)};
      const normalize = (text) => String(text || '').replace(/\\s+/g, '').toLowerCase();
      const isFid = (text) => /^[a-f0-9]{32}$/i.test(String(text || ''));
      const state = window.store?.getState?.() || {};
      const dispatch = window.store?.dispatch;

      const records = [];
      const seen = new Set();
      const add = (record, source) => {
        if (!record || typeof record !== 'object') return;
        const fid = record.fid || record.file_id || record.first_save_as_fid;
        if (!fid || seen.has(fid)) return;
        seen.add(fid);
        records.push({ ...record, fid, __opencliSource: source });
      };
      const addArray = (value, source) => {
        if (Array.isArray(value)) value.forEach((item) => add(item, source));
      };

      addArray(state.videoTab?.videoFilterResult, 'videoTab.videoFilterResult');
      addArray(state.videoTab?.recentVideoPlay?.list, 'videoTab.recentVideoPlay.list');
      addArray(state.file?.video?.list, 'file.video.list');
      addArray(state.saveFiles?.videoList, 'saveFiles.videoList');
      addArray(state.homeCard?.recentList, 'homeCard.recentList');
      addArray(state.allFiles?.list, 'allFiles.list');
      addArray(state.mysave?.list, 'mysave.list');

      let matched = null;
      if (isFid(input)) {
        matched = records.find((record) => record.fid === input) || { fid: input };
      } else {
        const wanted = normalize(input);
        matched = records.find((record) => normalize(record.file_name || record.name || record.title) === wanted)
          || records.find((record) => normalize(record.file_name || record.name || record.title).includes(wanted));
      }

      if (!matched && !isFid(input)) {
        const textMatch = [...document.querySelectorAll('img,[style],div,span')]
          .map((el) => {
            const text = el.innerText || el.textContent || '';
            const src = el.getAttribute?.('src') || el.getAttribute?.('style') || '';
            const html = src || el.outerHTML || '';
            const fid = /[?&]fid=([a-f0-9]{32})/i.exec(html)?.[1];
            return { fid, text };
          })
          .find((item) => item.fid && normalize(item.text).includes(normalize(input)));
        if (textMatch) matched = { fid: textMatch.fid, __opencliSource: 'dom' };
      }

      const fid = matched?.fid || (isFid(input) ? input : '');
      if (!fid) {
        return { ok: false, reason: 'video-not-found', input, known: records.slice(0, 20).map((record) => ({
          fid: record.fid,
          file_name: record.file_name || record.name || record.title || '',
          source: record.__opencliSource || '',
        })) };
      }

      let fileInfo = matched && matched.file_name ? matched : null;
      if (dispatch?.preview?.getFileInfoAndCheckTransStatus) {
        fileInfo = await dispatch.preview.getFileInfoAndCheckTransStatus(fid);
      }
      if (!fileInfo?.fid) {
        return { ok: false, reason: 'file-info-not-found', fid, input };
      }

      let req = null;
      const chunk = window.webpackChunkquark_cloud_drive = window.webpackChunkquark_cloud_drive || [];
      chunk.push([[Date.now() + Math.floor(Math.random() * 100000)], {}, (webpackRequire) => { req = webpackRequire; }]);
      if (!req) return { ok: false, reason: 'webpack-require-not-found', fid };

      const bridgeModule = req(334340);
      const bridge = bridgeModule?.default || bridgeModule;
      if (!bridge?.invoke) return { ok: false, reason: 'native-bridge-not-found', fid };

      let playFid = fileInfo.fid;
      let courseId = '';
      let noteId = '';
      if (fileInfo.display_extra?.course_video_fid) {
        playFid = fileInfo.display_extra.course_video_fid;
        courseId = fileInfo.display_extra.course_id || '';
      } else if (fileInfo.display_extra?.doc_video_fid) {
        playFid = fileInfo.display_extra.doc_video_fid;
        noteId = fileInfo.display_extra.doc_id || '';
      }

      let preFetchPlayInfo;
      try {
        preFetchPlayInfo = req(966117)?.preFetchPlayInfoPool?.get?.(playFid);
      } catch {}

      const payload = {
        seriesId: fileInfo.series_info_v2?.series_id || '',
        uid: String(state.user?.uid || ''),
        type: '3',
        subType: '301',
        from: '103001',
        filePath: '',
        playAuto: 'on',
        fid: playFid,
        fileInfo,
        sourceLang: '',
        translateLang: '',
        isSharePreview: false,
        fidToken: '',
        stoken: '',
        pwdId: '',
        title: fileInfo.file_name || fileInfo.name || input,
        course_id: courseId,
        noteId,
        preFetchPlayInfo,
        subScene: '',
      };
      if (playerTab) {
        payload.default_tab = playerTab;
        payload.tab = playerTab;
      }

      const invokeResult = await bridge.invoke('sys.openVideoPlayer', payload);
      window.__OPENCLI_LAST_VIDEO__ = {
        fid: playFid,
        originalFid: fid,
        title: payload.title,
        tab: playerTab,
      };
      return {
        ok: true,
        fid: playFid,
        originalFid: fid,
        title: payload.title,
        source: matched?.__opencliSource || '',
        tab: playerTab,
        invokeResult: invokeResult == null ? '' : JSON.stringify(invokeResult).slice(0, 200),
      };
    })()
  `);

  if (!result?.ok) {
    const known = result?.known?.map((record) => `${record.file_name || '(no name)'}:${record.fid}`).join(', ');
    throw new Error(`Could not open Quark video "${input}": ${result?.reason || 'unknown'}${known ? `. Known videos: ${known}` : ''}`);
  }

  await page.wait(1);
  return {
    Status: 'Opened',
    Name: result.title,
    Fid: result.fid,
    Source: result.source,
    TargetTab: result.tab,
    Result: result.invokeResult,
  };
}
