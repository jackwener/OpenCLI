/**
 * Pure InnerTube parsing helpers shared by `youtube channel` and
 * `youtube channel-videos`. Kept in their own module (no cli() call) so a
 * command file can import them without registering another command as a
 * side effect — the manifest builder attributes commands to the module that
 * registers them during import.
 */
export function extractSelectedRichGridContents(browseData) {
    const tabs = browseData?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
    const readRichGrid = (tab) => tab?.tabRenderer?.content?.richGridRenderer?.contents;
    const selectedTab = tabs.find(t => t?.tabRenderer?.selected);
    const selectedContents = readRichGrid(selectedTab);
    if (Array.isArray(selectedContents))
        return selectedContents;
    const fallbackContents = readRichGrid(tabs.find(t => {
        const contents = readRichGrid(t);
        return Array.isArray(contents) && contents.length > 0;
    })) || readRichGrid(tabs.find(t => Array.isArray(readRichGrid(t))));
    return Array.isArray(fallbackContents) ? fallbackContents : [];
}

export function parseVideoItem(item) {
    const content = item?.richItemRenderer?.content || item || {};
    const normalizeId = (value) => {
        const id = String(value || '').trim();
        return /^[A-Za-z0-9_-]+$/.test(id) ? id : '';
    };
    // New lockupViewModel format
    const lvm = content.lockupViewModel;
    if (lvm && lvm.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') {
        const id = normalizeId(lvm.contentId);
        const meta = lvm.metadata?.lockupMetadataViewModel;
        const title = meta?.title?.content || '';
        if (!id || !title)
            return null;
        const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows || [];
        const parts = (rows[0]?.metadataParts || []).map(p => p.text?.content).filter(Boolean);
        let duration = '';
        for (const ov of (lvm.contentImage?.thumbnailViewModel?.overlays || [])) {
            for (const b of (ov.thumbnailBottomOverlayViewModel?.badges || [])) {
                if (b.thumbnailBadgeViewModel?.text) duration = b.thumbnailBadgeViewModel.text;
            }
        }
        return {
            video_id: id,
            title,
            duration,
            views: parts.join(' | '),
            published: parts.length > 1 ? parts[parts.length - 1] : '',
            url: 'https://www.youtube.com/watch?v=' + id,
        };
    }
    // Legacy videoRenderer format
    const v = content.videoRenderer || content.gridVideoRenderer;
    if (v) {
        const id = normalizeId(v.videoId);
        const title = v.title?.runs?.[0]?.text || v.title?.simpleText || '';
        if (!id || !title)
            return null;
        return {
            video_id: id,
            title,
            duration: v.lengthText?.simpleText || v.thumbnailOverlays?.find(o => o.thumbnailOverlayTimeStatusRenderer)?.thumbnailOverlayTimeStatusRenderer?.text?.simpleText || '',
            views: (v.shortViewCountText?.simpleText || '') + (v.publishedTimeText?.simpleText ? ' | ' + v.publishedTimeText.simpleText : ''),
            published: v.publishedTimeText?.simpleText || '',
            url: 'https://www.youtube.com/watch?v=' + id,
        };
    }
    return null;
}
