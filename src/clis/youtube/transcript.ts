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
import { cli, Strategy } from '../../registry.js';
import {
  groupTranscriptSegments,
  formatGroupedTranscript,
  type RawSegment,
  type Chapter,
} from '../../transcript-group.js';

cli({
  site: 'youtube',
  name: 'transcript',
  description: 'Get YouTube video transcript/subtitles',
  domain: 'www.youtube.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'url', required: true, help: 'YouTube video URL or video ID' },
    { name: 'lang', required: false, help: 'Language code (e.g. en, zh-Hans). Omit to auto-select' },
    { name: 'mode', required: false, default: 'grouped', help: 'Output mode: grouped (readable paragraphs) or raw (every segment)' },
  ],
  // columns intentionally omitted — raw and grouped modes return different schemas,
  // so we let the renderer auto-detect columns from the data keys.
  func: async (page, kwargs) => {
    let videoId = kwargs.url;
    if (kwargs.url.startsWith('http')) {
      try {
        const parsed = new URL(kwargs.url);
        if (parsed.searchParams.has('v')) {
          videoId = parsed.searchParams.get('v')!;
        } else if (parsed.hostname === 'youtu.be') {
          videoId = parsed.pathname.slice(1).split('/')[0];
        } else {
          // Handle /shorts/xxx, /embed/xxx, /live/xxx, /v/xxx
          const pathMatch = parsed.pathname.match(/^\/(shorts|embed|live|v)\/([^/?]+)/);
          if (pathMatch) videoId = pathMatch[2];
        }
      } catch {
        // Not a valid URL — treat entire input as video ID
      }
    }

    // Always navigate to canonical watch?v= page for consistent ytcfg context
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    await page.goto(videoUrl);
    await page.wait(3);

    const lang = kwargs.lang || '';
    const mode = kwargs.mode || 'grouped';

    // Step 1: Get caption track URL via Android InnerTube API
    const captionData = await page.evaluate(`
      (async function() {
        var cfg = window.ytcfg && window.ytcfg.data_ || {};
        var apiKey = cfg.INNERTUBE_API_KEY;
        if (!apiKey) return { error: 'INNERTUBE_API_KEY not found on page' };

        var videoId = ${JSON.stringify(videoId)};

        var resp = await fetch('/youtubei/v1/player?key=' + apiKey + '&prettyPrint=false', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38' } },
            videoId: videoId
          })
        });

        if (!resp.ok) return { error: 'InnerTube player API returned HTTP ' + resp.status };
        var data = await resp.json();

        var renderer = data.captions && data.captions.playerCaptionsTracklistRenderer;
        if (!renderer || !renderer.captionTracks || renderer.captionTracks.length === 0) {
          return { error: 'No captions available for this video' };
        }

        var tracks = renderer.captionTracks;
        var available = [];
        for (var i = 0; i < tracks.length; i++) {
          available.push(tracks[i].languageCode + (tracks[i].kind === 'asr' ? ' (auto)' : ''));
        }

        var langPref = ${JSON.stringify(lang)};
        var track = null;
        if (langPref) {
          for (var i = 0; i < tracks.length; i++) {
            if (tracks[i].languageCode === langPref) { track = tracks[i]; break; }
          }
          if (!track) {
            for (var i = 0; i < tracks.length; i++) {
              if (tracks[i].languageCode.indexOf(langPref) === 0) { track = tracks[i]; break; }
            }
          }
        }
        if (!track) {
          for (var i = 0; i < tracks.length; i++) {
            if (tracks[i].kind !== 'asr') { track = tracks[i]; break; }
          }
          if (!track) track = tracks[0];
        }

        var langMatched = !!(langPref && track.languageCode === langPref);
        var langPrefixMatched = !!(langPref && !langMatched && track.languageCode.indexOf(langPref) === 0);

        return {
          captionUrl: track.baseUrl,
          language: track.languageCode,
          kind: track.kind || 'manual',
          available: available,
          requestedLang: langPref || null,
          langMatched: langMatched,
          langPrefixMatched: langPrefixMatched
        };
      })()
    `);

    if (!captionData || typeof captionData === 'string') {
      throw new Error(`Failed to get caption info: ${typeof captionData === 'string' ? captionData : 'null response'}`);
    }
    if (captionData.error) {
      throw new Error(`${captionData.error}${captionData.available ? ' (available: ' + captionData.available.join(', ') + ')' : ''}`);
    }

    // Warn if --lang was specified but not matched
    if (captionData.requestedLang && !captionData.langMatched && !captionData.langPrefixMatched) {
      console.error(`Warning: --lang "${captionData.requestedLang}" not found. Using "${captionData.language}" instead. Available: ${captionData.available.join(', ')}`);
    }

    // Step 2: Fetch caption XML and parse segments
    const segments: RawSegment[] = await page.evaluate(`
      (async function() {
        var url = ${JSON.stringify(captionData.captionUrl)};
        var resp = await fetch(url);
        var xml = await resp.text();

        if (!xml || xml.length === 0) {
          return { error: 'Caption URL returned empty response' };
        }

        function getAttr(tag, name) {
          var needle = name + '="';
          var idx = tag.indexOf(needle);
          if (idx === -1) return '';
          var valStart = idx + needle.length;
          var valEnd = tag.indexOf('"', valStart);
          if (valEnd === -1) return '';
          return tag.substring(valStart, valEnd);
        }

        function decodeEntities(s) {
          var r = s;
          while (r.indexOf('&amp;') !== -1) r = r.split('&amp;').join('&');
          while (r.indexOf('&lt;') !== -1) r = r.split('&lt;').join('<');
          while (r.indexOf('&gt;') !== -1) r = r.split('&gt;').join('>');
          while (r.indexOf('&quot;') !== -1) r = r.split('&quot;').join('"');
          while (r.indexOf('&#39;') !== -1) r = r.split('&#39;').join("'");
          return r;
        }

        var isFormat3 = xml.indexOf('<p t="') !== -1;
        var marker = isFormat3 ? '<p ' : '<text ';
        var endMarker = isFormat3 ? '</p>' : '</text>';
        var results = [];
        var pos = 0;

        while (true) {
          var tagStart = xml.indexOf(marker, pos);
          if (tagStart === -1) break;
          var contentStart = xml.indexOf('>', tagStart);
          if (contentStart === -1) break;
          contentStart += 1;
          var tagEnd = xml.indexOf(endMarker, contentStart);
          if (tagEnd === -1) break;

          var attrStr = xml.substring(tagStart + marker.length, contentStart - 1);
          var content = xml.substring(contentStart, tagEnd);

          var startSec, durSec;
          if (isFormat3) {
            startSec = (parseFloat(getAttr(attrStr, 't')) || 0) / 1000;
            durSec = (parseFloat(getAttr(attrStr, 'd')) || 0) / 1000;
          } else {
            startSec = parseFloat(getAttr(attrStr, 'start')) || 0;
            durSec = parseFloat(getAttr(attrStr, 'dur')) || 0;
          }

          // Strip inner tags (e.g. <s> in srv3 format) and decode entities
          var text = decodeEntities(content.replace(/<[^>]+>/g, '')).split('\\n').join(' ').trim();
          if (text) {
            results.push({ start: startSec, end: startSec + durSec, text: text });
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
      throw new Error((segments as any)?.error || 'Failed to parse caption segments');
    }
    if (segments.length === 0) {
      throw new Error('No caption segments found');
    }

    // Step 3: Fetch chapters (for grouped mode)
    let chapters: Chapter[] = [];
    if (mode === 'grouped') {
      try {
        const chapterData = await page.evaluate(`
          (async function() {
            var cfg = window.ytcfg && window.ytcfg.data_ || {};
            var apiKey = cfg.INNERTUBE_API_KEY;
            if (!apiKey) return [];

            var resp = await fetch('/youtubei/v1/next?key=' + apiKey + '&prettyPrint=false', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                context: { client: { clientName: 'WEB', clientVersion: '2.20240101.00.00' } },
                videoId: ${JSON.stringify(videoId)}
              })
            });
            if (!resp.ok) return [];
            var data = await resp.json();

            var chapters = [];

            // Try chapterRenderer from player bar
            var panels = data.playerOverlays
              && data.playerOverlays.playerOverlayRenderer
              && data.playerOverlays.playerOverlayRenderer.decoratedPlayerBarRenderer
              && data.playerOverlays.playerOverlayRenderer.decoratedPlayerBarRenderer.decoratedPlayerBarRenderer
              && data.playerOverlays.playerOverlayRenderer.decoratedPlayerBarRenderer.decoratedPlayerBarRenderer.playerBar
              && data.playerOverlays.playerOverlayRenderer.decoratedPlayerBarRenderer.decoratedPlayerBarRenderer.playerBar.multiMarkersPlayerBarRenderer
              && data.playerOverlays.playerOverlayRenderer.decoratedPlayerBarRenderer.decoratedPlayerBarRenderer.playerBar.multiMarkersPlayerBarRenderer.markersMap;

            if (Array.isArray(panels)) {
              for (var p = 0; p < panels.length; p++) {
                var markers = panels[p].value && panels[p].value.chapters;
                if (!Array.isArray(markers)) continue;
                for (var m = 0; m < markers.length; m++) {
                  var ch = markers[m].chapterRenderer;
                  if (!ch) continue;
                  var title = ch.title && ch.title.simpleText || '';
                  var startMs = ch.timeRangeStartMillis;
                  if (title && typeof startMs === 'number') {
                    chapters.push({ title: title, start: startMs / 1000 });
                  }
                }
              }
            }
            if (chapters.length > 0) return chapters;

            // Fallback: macroMarkersListItemRenderer from engagement panels
            var engPanels = data.engagementPanels;
            if (!Array.isArray(engPanels)) return [];
            for (var ep = 0; ep < engPanels.length; ep++) {
              var content = engPanels[ep].engagementPanelSectionListRenderer
                && engPanels[ep].engagementPanelSectionListRenderer.content;
              var items = content && content.macroMarkersListRenderer && content.macroMarkersListRenderer.contents;
              if (!Array.isArray(items)) continue;
              for (var it = 0; it < items.length; it++) {
                var renderer = items[it].macroMarkersListItemRenderer;
                if (!renderer) continue;
                var t = renderer.title && renderer.title.simpleText || '';
                var ts = renderer.timeDescription && renderer.timeDescription.simpleText || '';
                if (!t || !ts) continue;
                var parts = ts.split(':').map(Number);
                var secs = null;
                if (parts.length === 3 && parts.every(function(n) { return !isNaN(n); })) secs = parts[0]*3600 + parts[1]*60 + parts[2];
                else if (parts.length === 2 && parts.every(function(n) { return !isNaN(n); })) secs = parts[0]*60 + parts[1];
                if (secs !== null) chapters.push({ title: t, start: secs });
              }
            }
            return chapters;
          })()
        `);
        if (Array.isArray(chapterData)) {
          chapters = chapterData;
        }
      } catch {
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
    const grouped = groupTranscriptSegments(
      segments.map(s => ({ start: s.start, text: s.text })),
    );
    const { rows } = formatGroupedTranscript(grouped, chapters);
    return rows;
  },
});
