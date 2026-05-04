/**
 * YouTube transcript — uses InnerTube player API with Android client context.
 *
 * The Web client's caption URLs require a PoToken (proof of origin) generated
 * by BotGuard at runtime. The Android client returns caption URLs that work
 * without PoToken — same approach used by youtube-transcript-api (Python).
 *
 * Modes:
 *   --mode grouped (default): sentences merged, speaker detection, chapters
 *   --mode raw: every caption segment as-is with precise timestamps
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { parseVideoId, prepareYoutubeApiPage } from './utils.js';
import { groupTranscriptSegments, formatGroupedTranscript, } from './transcript-group.js';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
cli({
    site: 'youtube',
    name: 'transcript',
    access: 'read',
    description: 'Get YouTube video transcript/subtitles',
    domain: 'www.youtube.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'url', required: true, positional: true, help: 'YouTube video URL or video ID' },
        { name: 'lang', required: false, help: 'Language code (e.g. en, zh-Hans). Omit to auto-select' },
        { name: 'mode', required: false, default: 'grouped', help: 'Output mode: grouped (readable paragraphs) or raw (every segment)' },
    ],
    // columns intentionally omitted — raw and grouped modes return different schemas,
    // so we let the renderer auto-detect columns from the data keys.
    func: async (page, kwargs) => {
        const videoId = parseVideoId(kwargs.url);
        await prepareYoutubeApiPage(page);
        const lang = kwargs.lang || '';
        const mode = kwargs.mode || 'grouped';
        // Step 1: Get caption track URL via Android InnerTube API
        const captionData = await page.evaluate(`
      (async () => {
        const cfg = window.ytcfg?.data_ || {};
        const apiKey = cfg.INNERTUBE_API_KEY;
        if (!apiKey) return { error: 'INNERTUBE_API_KEY not found on page' };

        const resp = await fetch('/youtubei/v1/player?key=' + apiKey + '&prettyPrint=false', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38' } },
            videoId: ${JSON.stringify(videoId)}
          })
        });

        if (!resp.ok) return { error: 'InnerTube player API returned HTTP ' + resp.status };
        const data = await resp.json();

        const renderer = data.captions?.playerCaptionsTracklistRenderer;
        if (!renderer?.captionTracks?.length) {
          return { error: 'No captions available for this video' };
        }

        const tracks = renderer.captionTracks;
        const available = tracks.map(t => t.languageCode + (t.kind === 'asr' ? ' (auto)' : ''));

        const langPref = ${JSON.stringify(lang)};
        let track = null;
        if (langPref) {
          track = tracks.find(t => t.languageCode === langPref)
            || tracks.find(t => t.languageCode.startsWith(langPref));
        }
        if (!track) {
          track = tracks.find(t => t.kind !== 'asr') || tracks[0];
        }

        return {
          captionUrl: track.baseUrl,
          language: track.languageCode,
          kind: track.kind || 'manual',
          available,
          requestedLang: langPref || null,
          langMatched: !!(langPref && track.languageCode === langPref),
          langPrefixMatched: !!(langPref && track.languageCode !== langPref && track.languageCode.startsWith(langPref))
        };
      })()
    `);
        if (!captionData || typeof captionData === 'string') {
            throw new CommandExecutionError(`Failed to get caption info: ${typeof captionData === 'string' ? captionData : 'null response'}`);
        }
        if (captionData.error) {
            throw new CommandExecutionError(`${captionData.error}${captionData.available ? ' (available: ' + captionData.available.join(', ') + ')' : ''}`);
        }
        // Warn if --lang was specified but not matched
        if (captionData.requestedLang && !captionData.langMatched && !captionData.langPrefixMatched) {
            console.error(`Warning: --lang "${captionData.requestedLang}" not found. Using "${captionData.language}" instead. Available: ${captionData.available.join(', ')}`);
        }
        // Step 2: Fetch caption XML and parse segments
        const segments = await page.evaluate(`
      (async () => {
        const resp = await fetch(${JSON.stringify(captionData.captionUrl)});
        const xml = await resp.text();

        if (!xml?.length) {
          return { error: 'Caption URL returned empty response' };
        }

        function getAttr(tag, name) {
          const needle = name + '="';
          const idx = tag.indexOf(needle);
          if (idx === -1) return '';
          const valStart = idx + needle.length;
          const valEnd = tag.indexOf('"', valStart);
          if (valEnd === -1) return '';
          return tag.substring(valStart, valEnd);
        }

        function decodeEntities(s) {
          return s
            .replaceAll('&amp;', '&')
            .replaceAll('&lt;', '<')
            .replaceAll('&gt;', '>')
            .replaceAll('&quot;', '"')
            .replaceAll('&#39;', "'");
        }

        const isFormat3 = xml.includes('<p t="');
        const marker = isFormat3 ? '<p ' : '<text ';
        const endMarker = isFormat3 ? '</p>' : '</text>';
        const results = [];
        let pos = 0;

        while (true) {
          const tagStart = xml.indexOf(marker, pos);
          if (tagStart === -1) break;
          let contentStart = xml.indexOf('>', tagStart);
          if (contentStart === -1) break;
          contentStart += 1;
          const tagEnd = xml.indexOf(endMarker, contentStart);
          if (tagEnd === -1) break;

          const attrStr = xml.substring(tagStart + marker.length, contentStart - 1);
          const content = xml.substring(contentStart, tagEnd);

          let startSec, durSec;
          if (isFormat3) {
            startSec = (parseFloat(getAttr(attrStr, 't')) || 0) / 1000;
            durSec = (parseFloat(getAttr(attrStr, 'd')) || 0) / 1000;
          } else {
            startSec = parseFloat(getAttr(attrStr, 'start')) || 0;
            durSec = parseFloat(getAttr(attrStr, 'dur')) || 0;
          }

          // Strip inner tags (e.g. <s> in srv3 format) and decode entities
          const text = decodeEntities(content.replace(/<[^>]+>/g, '')).split('\\\\n').join(' ').trim();
          if (text) {
            results.push({ start: startSec, end: startSec + durSec, text });
          }

          pos = tagEnd + endMarker.length;
        }

        if (results.length === 0) {
          return { error: 'Parsed 0 segments from caption XML' };
        }

        return results;
      })()
    `);
        if (!Array.isArray(segments)) {
            throw new CommandExecutionError(segments?.error || 'Failed to parse caption segments');
        }
        if (segments.length === 0) {
            throw new EmptyResultError('youtube transcript');
        }
        // Step 3: Fetch chapters (for grouped mode)
        let chapters = [];
        if (mode === 'grouped') {
            try {
                const chapterData = await page.evaluate(`
          (async () => {
            const cfg = window.ytcfg?.data_ || {};
            const apiKey = cfg.INNERTUBE_API_KEY;
            if (!apiKey) return [];

            const resp = await fetch('/youtubei/v1/next?key=' + apiKey + '&prettyPrint=false', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                context: { client: { clientName: 'WEB', clientVersion: '2.20240101.00.00' } },
                videoId: ${JSON.stringify(videoId)}
              })
            });
            if (!resp.ok) return [];
            const data = await resp.json();

            const chapters = [];

            // Try chapterRenderer from player bar
            const panels = data.playerOverlays?.playerOverlayRenderer
              ?.decoratedPlayerBarRenderer?.decoratedPlayerBarRenderer
              ?.playerBar?.multiMarkersPlayerBarRenderer?.markersMap;

            if (Array.isArray(panels)) {
              for (const panel of panels) {
                const markers = panel.value?.chapters;
                if (!Array.isArray(markers)) continue;
                for (const marker of markers) {
                  const ch = marker.chapterRenderer;
                  if (!ch) continue;
                  const title = ch.title?.simpleText || '';
                  const startMs = ch.timeRangeStartMillis;
                  if (title && typeof startMs === 'number') {
                    chapters.push({ title, start: startMs / 1000 });
                  }
                }
              }
            }
            if (chapters.length > 0) return chapters;

            // Fallback: macroMarkersListItemRenderer from engagement panels
            const engPanels = data.engagementPanels;
            if (!Array.isArray(engPanels)) return [];
            for (const ep of engPanels) {
              const content = ep.engagementPanelSectionListRenderer?.content;
              const items = content?.macroMarkersListRenderer?.contents;
              if (!Array.isArray(items)) continue;
              for (const item of items) {
                const renderer = item.macroMarkersListItemRenderer;
                if (!renderer) continue;
                const t = renderer.title?.simpleText || '';
                const ts = renderer.timeDescription?.simpleText || '';
                if (!t || !ts) continue;
                const parts = ts.split(':').map(Number);
                let secs = null;
                if (parts.length === 3 && parts.every(n => !isNaN(n))) secs = parts[0]*3600 + parts[1]*60 + parts[2];
                else if (parts.length === 2 && parts.every(n => !isNaN(n))) secs = parts[0]*60 + parts[1];
                if (secs !== null) chapters.push({ title: t, start: secs });
              }
            }
            return chapters;
          })()
        `);
                if (Array.isArray(chapterData)) {
                    chapters = chapterData;
                }
            }
            catch {
                // Chapters are optional — proceed without them
            }
        }
        // Step 4: Format output based on mode
        if (mode === 'raw') {
            // Precise timestamps in seconds with decimals, matching bilibili/subtitle format
            return segments.map((seg, i) => ({
                index: i + 1,
                start: Number(seg.start).toFixed(2) + 's',
                end: Number(seg.end).toFixed(2) + 's',
                text: seg.text,
            }));
        }
        // Grouped mode: merge sentences, detect speakers, insert chapters
        const grouped = groupTranscriptSegments(segments.map(s => ({ start: s.start, text: s.text })));
        const { rows } = formatGroupedTranscript(grouped, chapters);
        return rows;
    },
});
