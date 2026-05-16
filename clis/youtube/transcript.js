/**
 * YouTube transcript — extracts caption tracks through the watch player.
 *
 * YouTube timedtext URLs can require player-generated PO tokens. Load the
 * watch page, ask the player captions module to select a track, then reuse the
 * generated json3 timedtext URL before falling back to watch HTML captions.
 *
 * Modes:
 *   --mode grouped (default): sentences merged, speaker detection, chapters
 *   --mode raw: every caption segment as-is with precise timestamps
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { extractJsonAssignmentFromHtml, parseVideoId, prepareYoutubeApiPage } from './utils.js';
import { groupTranscriptSegments, formatGroupedTranscript, } from './transcript-group.js';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

function unwrapBrowserResult(value) {
    if (value && typeof value === 'object' && 'session' in value && 'data' in value) {
        return value.data;
    }
    return value;
}

function normalizeSegmentsPayload(value, source, { allowNull = false } = {}) {
    const payload = unwrapBrowserResult(value);
    if (payload == null && allowNull)
        return null;
    if (Array.isArray(payload))
        return payload;
    if (payload && typeof payload === 'object' && payload.error) {
        throw new CommandExecutionError(String(payload.error));
    }
    throw new CommandExecutionError(`Malformed ${source} payload`);
}

function parseJson3Segments(text) {
    let data;
    try {
        data = JSON.parse(text);
    }
    catch (err) {
        throw new CommandExecutionError(`Malformed json3 timedtext response: ${err?.message || err}`);
    }
    if (!Array.isArray(data?.events)) {
        throw new CommandExecutionError('Malformed json3 timedtext response: missing events array');
    }
    const rows = [];
    for (const event of data.events) {
        const startMs = Number(event?.tStartMs || 0);
        const durMs = Number(event?.dDurationMs || 0);
        const segs = Array.isArray(event?.segs) ? event.segs : [];
        const line = segs.map(seg => seg?.utf8 || '').join('').replace(/\s+/g, ' ').trim();
        if (!line)
            continue;
        rows.push({
            start: startMs / 1000,
            end: (startMs + durMs) / 1000,
            text: line,
        });
    }
    return rows;
}

function extractSegmentsFromNetworkCapture(entries, lang) {
    const payload = unwrapBrowserResult(entries);
    if (!Array.isArray(payload) || payload.length === 0)
        return { segments: [] };
    const wanted = String(lang || '').toLowerCase();
    const wantedBase = wanted.split('-')[0];
    const timedtext = payload
        .filter((entry) => {
        const url = String(entry?.url || '');
        if (!url.includes('/api/timedtext'))
            return false;
        if (!url.includes('fmt=json3') || !url.includes('pot='))
            return false;
        if (!wanted)
            return true;
        try {
            const u = new URL(url);
            const got = String(u.searchParams.get('lang') || '').toLowerCase();
            const gotBase = got.split('-')[0];
            return got === wanted || gotBase === wantedBase || wantedBase === got;
        }
        catch {
            return false;
        }
    })
        .reverse();
    let malformed = '';
    for (const entry of timedtext) {
        const body = typeof entry?.responsePreview === 'string' ? entry.responsePreview : '';
        if (!body)
            continue;
        try {
            const parsed = parseJson3Segments(body);
            if (parsed.length > 0)
                return { segments: parsed };
        }
        catch (err) {
            malformed = err?.message || String(err);
        }
    }
    return malformed ? { error: malformed } : { segments: [] };
}

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
        const lang = kwargs.lang || '';
        const mode = kwargs.mode || 'grouped';
        const watchUrl = 'https://www.youtube.com/watch?v=' + encodeURIComponent(videoId);
        const canCapture = typeof page.startNetworkCapture === 'function' && typeof page.readNetworkCapture === 'function';
        if (canCapture) {
            try {
                await page.startNetworkCapture('/api/timedtext');
            }
            catch {
                // Best-effort only. The in-page capture and XML fallback still run.
            }
        }
        await page.goto(watchUrl, { waitUntil: 'none' });
        await page.wait(3);
        const playerResult = await page.evaluate(`
      (async () => {
        const langPref = ${JSON.stringify(lang)};
        const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        function textFromJson3Event(event) {
          if (!Array.isArray(event?.segs)) return '';
          return event.segs.map(seg => seg?.utf8 || '').join('').replace(/\\s+/g, ' ').trim();
        }

        function parseJson3(text) {
          let data;
          try {
            data = JSON.parse(text);
          } catch (err) {
            return { error: 'Malformed json3 timedtext response: ' + (err?.message || String(err)) };
          }
          if (!Array.isArray(data.events)) {
            return { error: 'Malformed json3 timedtext response: missing events array' };
          }
          const rows = [];
          for (const event of data.events) {
            const startMs = Number(event.tStartMs || 0);
            const durMs = Number(event.dDurationMs || 0);
            const text = textFromJson3Event(event);
            if (!text) continue;
            rows.push({
              start: startMs / 1000,
              end: (startMs + durMs) / 1000,
              text,
            });
          }
          return { rows };
        }

        function captionTrackToPlayerTrack(track) {
          if (!track?.languageCode) return null;
          const name = track.name?.simpleText
            || (Array.isArray(track.name?.runs) ? track.name.runs.map(run => run?.text || '').join('') : '')
            || track.languageCode;
          return {
            displayName: name,
            id: null,
            is_default: false,
            is_servable: false,
            is_translateable: !!track.isTranslatable,
            kind: track.kind || '',
            languageCode: track.languageCode,
            languageName: name,
            name: '',
            vss_id: track.vssId || ((track.kind === 'asr' ? 'a.' : '.') + track.languageCode),
          };
        }

        function getTrackCandidates(player) {
          const tracklist = player?.getOption?.('captions', 'tracklist');
          if (Array.isArray(tracklist) && tracklist.length > 0) return tracklist;
          const captionTracks = player?.getPlayerResponse?.()
            ?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
          if (!Array.isArray(captionTracks)) return [];
          return captionTracks.map(captionTrackToPlayerTrack).filter(Boolean);
        }

        function pickTrack(tracklist) {
          if (!Array.isArray(tracklist) || tracklist.length === 0) return null;
          if (langPref) {
            return tracklist.find(t => t.languageCode === langPref)
              || tracklist.find(t => t.languageCode?.startsWith(langPref));
          }
          return tracklist.find(t => t.languageCode === 'en' && t.kind !== 'asr')
            || tracklist.find(t => t.languageCode === 'en')
            || tracklist.find(t => t.kind !== 'asr')
            || tracklist[0];
        }

        function findTimedtextUrl(track) {
          const urls = performance.getEntriesByType('resource')
            .map(entry => entry.name)
            .filter(url => url.includes('/api/timedtext') && url.includes('fmt=json3') && url.includes('pot='));
          if (!urls.length) return '';
          if (track?.languageCode) {
            const wanted = String(track.languageCode || '').toLowerCase();
            const wantedBase = wanted.split('-')[0];
            const match = [...urls].reverse().find((rawUrl) => {
              try {
                const u = new URL(rawUrl, location.origin);
                const got = String(u.searchParams.get('lang') || '').toLowerCase();
                const gotBase = got.split('-')[0];
                return got === wanted || gotBase === wantedBase || wantedBase === got;
              } catch {
                return false;
              }
            });
            if (match) return match;
          }
          return urls[urls.length - 1];
        }

        function isJson3TimedtextUrl(url, track) {
          if (!url || !url.includes('/api/timedtext')) return false;
          if (!url.includes('fmt=json3')) return false;
          if (!url.includes('pot=')) return false;
          if (!track?.languageCode) return true;
          try {
            const u = new URL(url, location.origin);
            const got = String(u.searchParams.get('lang') || '').toLowerCase();
            const wanted = String(track.languageCode || '').toLowerCase();
            const gotBase = got.split('-')[0];
            const wantedBase = wanted.split('-')[0];
            return got === wanted || gotBase === wantedBase || wantedBase === got;
          } catch {
            return false;
          }
        }

        const player = document.getElementById('movie_player');
        if (!player?.getOption || !player?.setOption) {
          return null;
        }

        let track = null;
        for (let i = 0; i < 20; i++) {
          track = pickTrack(getTrackCandidates(player));
          if (track) break;
          await sleep(500);
        }
        if (!track) return null;

        const originalFetch = globalThis.fetch;
        const boundOriginalFetch = originalFetch?.bind(globalThis);
        const OriginalXHR = globalThis.XMLHttpRequest;
        let capturedJson3Text = '';
        try {
          if (boundOriginalFetch) {
            globalThis.fetch = async (...args) => {
              const response = await boundOriginalFetch(...args);
              try {
                const req = args[0];
                const reqUrl = typeof req === 'string' ? req : req?.url || '';
                if (isJson3TimedtextUrl(reqUrl, track) && response?.ok) {
                  const text = await response.clone().text();
                  if (text && !capturedJson3Text) {
                    capturedJson3Text = text;
                  }
                }
              } catch {}
              return response;
            };
          }
          if (OriginalXHR) {
            globalThis.XMLHttpRequest = class TimedtextCaptureXHR extends OriginalXHR {
              open(method, url, ...rest) {
                this.__opencliTimedtextUrl = typeof url === 'string' ? url : '';
                return super.open(method, url, ...rest);
              }
              send(...args) {
                this.addEventListener('load', () => {
                  try {
                    const url = this.__opencliTimedtextUrl || this.responseURL || '';
                    if (!isJson3TimedtextUrl(url, track)) return;
                    if (this.status < 200 || this.status >= 300) return;
                    const text = typeof this.responseText === 'string' ? this.responseText : '';
                    if (text && !capturedJson3Text) {
                      capturedJson3Text = text;
                    }
                  } catch {}
                });
                return super.send(...args);
              }
            };
          }

          // Do not clear resource timings: some videos emit a valid timedtext URL
          // before our polling loop starts; keeping existing entries avoids misses.
          try { player.loadModule?.('captions'); } catch {}
          await sleep(500);
          try { player.setOption('captions', 'track', track); } catch {}
          try { player.playVideo?.(); } catch {}

          for (let i = 0; i < 30; i++) {
            await sleep(500);
            if (capturedJson3Text) {
              const parsed = parseJson3(capturedJson3Text);
              if (parsed.error) return { error: parsed.error };
              if (parsed.rows.length > 0) return parsed.rows;
            }
            const url = findTimedtextUrl(track);
            if (!url) continue;
            const resp = await fetch(url, { credentials: 'include' });
            if (!resp.ok) continue;
            const text = await resp.text();
            if (!text) continue;
            const parsed = parseJson3(text);
            if (parsed.error) return { error: parsed.error };
            if (parsed.rows.length > 0) return parsed.rows;
          }

          return null;
        } finally {
          try { player?.pauseVideo?.(); } catch {}
          if (originalFetch) globalThis.fetch = originalFetch;
          if (OriginalXHR) globalThis.XMLHttpRequest = OriginalXHR;
        }
      })()
    `);
        let segments = normalizeSegmentsPayload(playerResult, 'player caption extraction', { allowNull: true });
        if (!segments && canCapture) {
            try {
                const captured = extractSegmentsFromNetworkCapture(await page.readNetworkCapture(), lang);
                if (captured.error) {
                    throw new CommandExecutionError(captured.error);
                }
                if (captured.segments.length > 0) {
                    segments = captured.segments;
                }
            }
            catch (err) {
                if (err instanceof CommandExecutionError)
                    throw err;
                // Keep existing fallback path when capture is unavailable.
            }
        }
        if (!segments) {
            await prepareYoutubeApiPage(page);
        }
        // Fallback: get caption track URL from watch page HTML
        const captionData = segments ? null : unwrapBrowserResult(await page.evaluate(`
      (async () => {
        const extractJsonAssignmentFromHtml = ${extractJsonAssignmentFromHtml.toString()};

        const watchResp = await fetch('/watch?v=' + encodeURIComponent(${JSON.stringify(videoId)}), {
          credentials: 'include',
        });
        if (!watchResp.ok) return { error: 'Watch HTML returned HTTP ' + watchResp.status };

        const html = await watchResp.text();
        const player = extractJsonAssignmentFromHtml(html, 'ytInitialPlayerResponse');
        if (!player) return { error: 'ytInitialPlayerResponse not found in watch HTML' };

        const renderer = player.captions?.playerCaptionsTracklistRenderer;
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
    `));
        if (!segments && (!captionData || typeof captionData !== 'object' || Array.isArray(captionData))) {
            throw new CommandExecutionError(`Failed to get caption info: ${typeof captionData === 'string' ? captionData : 'malformed response'}`);
        }
        if (captionData?.error) {
            throw new CommandExecutionError(`${captionData.error}${captionData.available ? ' (available: ' + captionData.available.join(', ') + ')' : ''}`);
        }
        if (!segments && typeof captionData?.captionUrl !== 'string') {
            throw new CommandExecutionError('Malformed caption info payload');
        }
        // Warn if --lang was specified but not matched
        if (captionData?.requestedLang && !captionData.langMatched && !captionData.langPrefixMatched) {
            console.error(`Warning: --lang "${captionData.requestedLang}" not found. Using "${captionData.language}" instead. Available: ${captionData.available.join(', ')}`);
        }
        // Step 2: Fetch caption XML and parse segments
        // Ensure caption URL requests srv3 XML format — YouTube may return empty
        // responses when no explicit format is specified.
        if (!segments) {
            const originalCaptionUrl = captionData.captionUrl;
            let captionUrl = originalCaptionUrl;
            if (!/[&?]fmt=/.test(originalCaptionUrl)) {
                captionUrl = originalCaptionUrl + (originalCaptionUrl.includes('?') ? '&' : '?') + 'fmt=srv3';
            }
            segments = normalizeSegmentsPayload(await page.evaluate(`
      (async () => {
        async function fetchCaptionXml(url) {
          const resp = await fetch(url);
          if (!resp.ok) return { error: 'Caption URL returned HTTP ' + resp.status };
          return { xml: await resp.text() || '' };
        }

        const primaryUrl = ${JSON.stringify(captionUrl)};
        const originalUrl = ${JSON.stringify(originalCaptionUrl)};
        let result = await fetchCaptionXml(primaryUrl);
        if (result.error) return result;

        // If srv3 format returned an empty successful body, retry with the
        // original URL. Do not hide HTTP/non-OK failures behind fallback.
        if (!result.xml.length && originalUrl !== primaryUrl) {
          result = await fetchCaptionXml(originalUrl);
          if (result.error) {
            return result;
          }
        }
        const xml = result.xml;

        if (!xml.length) {
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
    `), 'caption XML extraction');
        }
        if (segments.length === 0) {
            throw new EmptyResultError('youtube transcript');
        }
        // Step 3: Fetch chapters (for grouped mode)
        let chapters = [];
        if (mode === 'grouped') {
            try {
                const chapterData = unwrapBrowserResult(await page.evaluate(`
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
        `));
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
