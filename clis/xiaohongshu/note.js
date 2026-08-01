/**
 * Xiaohongshu note — read full note content from a public note page.
 *
 * Extracts title, author, description text, and engagement metrics
 * (likes, collects, comment count) via DOM extraction.
 *
 * Requires a full Xiaohongshu note URL with xsec_token.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CliError, EmptyResultError } from '@jackwener/opencli/errors';
import { parseNoteId, buildNoteUrl } from './note-helpers.js';
/**
 * Host-agnostic IIFE that scrapes note content plus stable identity, publish
 * time, and ordered media from the rendered page and its hydration state.
 * Exported so the rednote adapter can reuse the same selector set.
 */
export function buildNoteExtractJs(requestedNoteId = '', webHost = 'www.xiaohongshu.com') {
    const encodedNoteId = JSON.stringify(String(requestedNoteId || ''));
    const encodedWebHost = JSON.stringify(String(webHost || 'www.xiaohongshu.com'));
    return `
      (() => {
        const requestedNoteId = ${encodedNoteId}
        const configuredWebHost = ${encodedWebHost}
        const activeWebHost = location.hostname.endsWith('rednote.com') ? 'www.rednote.com' : configuredWebHost
        const bodyText = document.body?.innerText || ''
        const loginWall = /登录后查看|请登录/.test(bodyText)
        const notFound = /页面不见了|笔记不存在|无法浏览/.test(bodyText)
        const securityBlock = /安全限制|访问链接异常/.test(bodyText)
          || /website-login\\/error|error_code=300017|error_code=300031/.test(location.href)

        const clean = (el) => (el?.textContent || '').replace(/\\s+/g, ' ').trim()
        const cleanValue = (value) => value == null ? '' : String(value).trim()
        const pathMatch = (location.pathname || '').match(
          /\\/(?:explore|note|search_result|discovery\\/item)\\/([a-f0-9]+)|\\/user\\/profile\\/[^/?#]+\\/([a-f0-9]+)/i
        )
        const noteId = pathMatch?.[1] || pathMatch?.[2] || requestedNoteId
        const canonicalUrl = noteId ? 'https://' + activeWebHost + '/explore/' + encodeURIComponent(noteId) : ''

        const getStructuredNote = () => {
          const state = window.__INITIAL_STATE__
          const noteData = state?.note?.noteDetailMap || state?.note?.note || {}
          if (!noteData || typeof noteData !== 'object') return null
          for (const id of [...new Set([noteId, requestedNoteId].filter(Boolean))]) {
            const entry = noteData[id]
            const note = entry?.note || entry
            if (note && typeof note === 'object') return note
          }
          const keys = Object.keys(noteData)
          if (keys.length === 1) {
            const entry = noteData[keys[0]]
            const note = entry?.note || entry
            if (note && typeof note === 'object') return note
          }
          return null
        }
        const note = getStructuredNote()

        const title = clean(document.querySelector('#detail-title, .title'))
          || cleanValue(note?.title ?? note?.displayTitle ?? note?.display_title)
        const desc = clean(document.querySelector('#detail-desc, .desc, .note-text'))
          || cleanValue(note?.desc ?? note?.content)
        const authorLink = document.querySelector(
          '.author-wrapper a[href*="/user/profile/"], a.username[href*="/user/profile/"], a[href*="/user/profile/"]'
        )
        const authorHref = authorLink?.getAttribute('href') || ''
        const authorPath = authorHref.match(/\\/user\\/profile\\/([^/?#]+)/)
        const structuredUser = note?.user || note?.userInfo || note?.user_info || {}
        const authorId = cleanValue(
          structuredUser.userId ?? structuredUser.user_id ?? structuredUser.id ?? note?.userId ?? authorPath?.[1]
        )
        const author = clean(document.querySelector('.username, .author-wrapper .name'))
          || cleanValue(structuredUser.nickname ?? structuredUser.nickName ?? structuredUser.name)
        const authorUrl = authorId
          ? 'https://' + activeWebHost + '/user/profile/' + encodeURIComponent(authorId)
          : ''

        // Scope to .interact-container so comment action counts are never
        // mistaken for the note's top-level engagement counts.
        const likes = clean(document.querySelector('.interact-container .like-wrapper .count'))
        const collects = clean(document.querySelector('.interact-container .collect-wrapper .count'))
        const comments = clean(document.querySelector('.interact-container .chat-wrapper .count'))

        const tags = []
        const seenTags = new Set()
        const pushTag = (value) => {
          const tag = cleanValue(value)
          if (tag && !seenTags.has(tag)) {
            seenTags.add(tag)
            tags.push(tag)
          }
        }
        document.querySelectorAll('#detail-desc a.tag, #detail-desc a[href*="search_result"]').forEach(el => {
          pushTag(el.textContent)
        })
        for (const tag of Array.isArray(note?.tagList) ? note.tagList : []) {
          pushTag(tag?.name ?? tag?.title ?? tag)
        }

        const normalizePublishedAt = (value) => {
          if (value == null || value === '') return ''
          let candidate = value
          if (typeof candidate === 'string' && /^\\d+$/.test(candidate.trim())) candidate = Number(candidate)
          if (typeof candidate === 'number') {
            if (!Number.isFinite(candidate) || candidate <= 0) return ''
            if (candidate < 1e12) candidate *= 1000
          }
          const date = new Date(candidate)
          return Number.isNaN(date.getTime()) ? '' : date.toISOString()
        }
        const publishedAt = normalizePublishedAt(
          note?.time ?? note?.publishTime ?? note?.publish_time ?? note?.createdAt ?? note?.createTime
        )

        const media = []
        const seenMedia = new Set()
        const normalizeMediaUrl = (value) => {
          const raw = cleanValue(value)
          if (!raw || raw.startsWith('blob:')) return ''
          if (raw.startsWith('//')) return 'https:' + raw
          try { return new URL(raw, location.href).href } catch { return '' }
        }
        const pushMedia = (type, value) => {
          const url = normalizeMediaUrl(value)
          if (!url) return
          const key = type + ':' + url
          if (seenMedia.has(key)) return
          seenMedia.add(key)
          media.push({ type, url })
        }

        let structuredVideoUsed = false
        const video = note?.video
        if (video) {
          const directVideo = video.url || video.originVideoKey || video.consumer?.originVideoKey
          if (directVideo) {
            pushMedia('video', /^https?:/.test(directVideo) ? directVideo : 'https://sns-video-bd.xhscdn.com/' + directVideo)
            structuredVideoUsed = true
          }
          const streams = video.media?.stream?.h264 || []
          for (const stream of streams) {
            if (stream?.masterUrl) {
              pushMedia('video', stream.masterUrl)
              structuredVideoUsed = true
            }
          }
        }
        if (!structuredVideoUsed) {
          document.querySelectorAll('video source, video[src], .player video, .video-player video').forEach(el => {
            pushMedia('video', el.src || el.getAttribute('src'))
          })
        }

        let structuredImagesUsed = false
        const imageList = Array.isArray(note?.imageList) ? note.imageList : []
        for (const image of imageList) {
          const candidate = image?.urlDefault || image?.urlPre || image?.url
            || image?.infoList?.find(item => item?.imageScene === 'WB_DFT')?.url
            || image?.infoList?.[0]?.url
          if (candidate) {
            pushMedia('image', candidate)
            structuredImagesUsed = true
          }
        }
        if (!structuredImagesUsed) {
          const selectors = [
            '.swiper-slide img', '.carousel-image img', '.note-slider img',
            '.note-image img', '.image-wrapper img',
            '#noteContainer .media-container img[src*="xhscdn"]',
            'img[src*="ci.xiaohongshu.com"]'
          ]
          for (const selector of selectors) {
            document.querySelectorAll(selector).forEach(img => {
              pushMedia('image', img.src || img.getAttribute('data-src'))
            })
          }
        }

        return {
          pageUrl: location.href,
          securityBlock,
          loginWall,
          notFound,
          id: noteId,
          url: canonicalUrl,
          title,
          desc,
          author,
          author_id: authorId,
          author_url: authorUrl,
          published_at: publishedAt,
          published_at_source: publishedAt ? 'initial_state' : '',
          likes,
          collects,
          comments,
          tags,
          media,
        }
      })()
    `;
}
export const NOTE_EXTRACT_JS = buildNoteExtractJs();
export const command = cli({
    site: 'xiaohongshu',
    name: 'note',
    access: 'read',
    description: '获取小红书笔记正文和互动数据',
    domain: 'www.xiaohongshu.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    args: [
        { name: 'note-id', required: true, positional: true, help: 'Full Xiaohongshu note URL with xsec_token' },
    ],
    columns: ['field', 'value'],
    func: async (page, kwargs) => {
        const raw = String(kwargs['note-id']);
        const noteId = parseNoteId(raw);
        const url = buildNoteUrl(raw, { commandName: 'xiaohongshu note' });
        await page.goto(url);
        await page.wait({ time: 2 + Math.random() * 3 });
        const data = await page.evaluate(buildNoteExtractJs(noteId));
        if (!data || typeof data !== 'object') {
            throw new EmptyResultError('xiaohongshu/note', 'Unexpected evaluate response');
        }
        if (data.securityBlock) {
            throw new CliError('SECURITY_BLOCK', 'Xiaohongshu security block: the note detail page was blocked by risk control.', /^https?:\/\//.test(raw)
                ? 'The page may be temporarily restricted. Try again later or from a different session.'
                : 'Try using a full URL from search results (with xsec_token) instead of a bare note ID.');
        }
        if (data.loginWall) {
            throw new AuthRequiredError('www.xiaohongshu.com', 'Note content requires login');
        }
        if (data.notFound) {
            throw new EmptyResultError('xiaohongshu/note', `Note ${noteId} not found or unavailable — it may have been deleted or restricted`);
        }
        const d = data;
        // XHS renders placeholder text like "赞"/"收藏"/"评论" when count is 0;
        // normalize to '0' unless the value looks numeric.
        const numOrZero = (v) => /^\d+/.test(v) ? v : '0';
        // Title + author are always present on a real note page.
        // If both are missing, the page likely failed to load properly.
        if (!d.title && !d.author) {
            throw new EmptyResultError('xiaohongshu/note', 'The note page loaded without visible content. The note may be deleted or restricted.');
        }
        const rows = [
            { field: 'id', value: d.id || noteId },
            { field: 'url', value: d.url || `https://www.xiaohongshu.com/explore/${encodeURIComponent(noteId)}` },
            { field: 'title', value: d.title || '' },
            { field: 'author', value: d.author || '' },
            { field: 'author_id', value: d.author_id || '' },
            { field: 'author_url', value: d.author_url || '' },
            { field: 'published_at', value: d.published_at || '' },
            { field: 'published_at_source', value: d.published_at_source || '' },
            { field: 'content', value: d.desc || '' },
            { field: 'likes', value: numOrZero(d.likes || '') },
            { field: 'collects', value: numOrZero(d.collects || '') },
            { field: 'comments', value: numOrZero(d.comments || '') },
            { field: 'media', value: Array.isArray(d.media) ? d.media : [] },
        ];
        if (d.tags?.length) {
            rows.push({ field: 'tags', value: d.tags.join(', ') });
        }
        return rows;
    },
});
