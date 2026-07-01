import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { buildInstagramFetchScript, ensurePage, handleFetchFailure, normalizeFetchResult, parseInstagramMediaTarget } from './download.js';

function normalizeCaptionText(raw) {
    return String(raw || '').replace(/\s+/g, ' ').trim();
}

function formatPostedAt(timestamp) {
    const seconds = Number(timestamp || 0);
    return Number.isFinite(seconds) && seconds > 0
        ? new Date(seconds * 1000).toISOString()
        : '';
}

function normalizeMediaNode(node) {
    if (!node || typeof node !== 'object') {
        return null;
    }
    const isVideo = node.is_video === true;
    const url = String(isVideo ? (node.video_url || '') : (node.display_url || '')).trim();
    if (!url) {
        return null;
    }
    return {
        kind: isVideo ? 'video' : 'image',
        url,
    };
}

function normalizeMediaNodes(media) {
    const sidecarNodes = Array.isArray(media?.edge_sidecar_to_children?.edges)
        ? media.edge_sidecar_to_children.edges.map((edge) => edge?.node).filter(Boolean)
        : [];
    const nodes = sidecarNodes.length > 0 ? sidecarNodes : [media];
    return nodes.map(normalizeMediaNode).filter(Boolean);
}

function resolvePostKind(targetKind, media) {
    const productType = String(media?.product_type || '').toLowerCase();
    if (productType === 'clips' || productType === 'reel' || targetKind === 'reel') {
        return 'reel';
    }
    return targetKind || 'p';
}

function resolvePostType(mediaNodes) {
    if (mediaNodes.length > 1) {
        return 'carousel';
    }
    return mediaNodes[0]?.kind || '';
}

function countFrom(edge) {
    const count = Number(edge?.count ?? 0);
    return Number.isFinite(count) ? count : 0;
}

function extractCaption(media) {
    const text = media?.edge_media_to_caption?.edges?.[0]?.node?.text || '';
    return normalizeCaptionText(text);
}

function normalizeDetailRow(target, media) {
    if (!media || typeof media !== 'object') {
        throw new CommandExecutionError('Instagram returned malformed media detail payload');
    }
    const shortcode = String(media.shortcode || target.shortcode || '').trim();
    const mediaId = String(media.id || '').trim();
    const ownerUsername = String(media?.owner?.username || '').trim();
    if (!shortcode || !mediaId || !ownerUsername) {
        throw new CommandExecutionError('Instagram returned malformed media detail payload');
    }
    const mediaNodes = normalizeMediaNodes(media);
    if (mediaNodes.length === 0) {
        throw new CommandExecutionError('Instagram detail payload did not contain any media URLs');
    }
    const postKind = resolvePostKind(target.kind, media);
    return {
        shortcode,
        media_id: mediaId,
        kind: postKind,
        type: resolvePostType(mediaNodes),
        posted_at: formatPostedAt(media.taken_at_timestamp),
        owner: ownerUsername,
        owner_name: String(media?.owner?.full_name || '').trim(),
        owner_verified: media?.owner?.is_verified ? 'Yes' : 'No',
        caption: extractCaption(media),
        likes: countFrom(media?.edge_media_preview_like),
        comments: countFrom(media?.edge_media_to_comment) || countFrom(media?.edge_media_to_parent_comment),
        views: Number.isFinite(Number(media?.video_view_count))
            ? Number(media.video_view_count)
            : Number.isFinite(Number(media?.video_play_count))
                ? Number(media.video_play_count)
                : '',
        media_count: mediaNodes.length,
        media_types: mediaNodes.map((node) => node.kind).join(', '),
        media_urls: mediaNodes.map((node) => node.url).join('\n'),
        thumbnail_url: String(media.display_url || '').trim(),
        url: target.canonicalUrl,
    };
}

cli({
    site: 'instagram',
    name: 'detail',
    access: 'read',
    description: 'Get single-post Instagram details, including direct media URLs',
    domain: 'www.instagram.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    args: [
        { name: 'url', positional: true, required: true, help: 'Instagram post / reel / tv URL' },
    ],
    columns: [
        'shortcode',
        'media_id',
        'kind',
        'type',
        'posted_at',
        'owner',
        'owner_name',
        'owner_verified',
        'likes',
        'comments',
        'views',
        'media_count',
        'media_types',
        'media_urls',
        'thumbnail_url',
        'url',
        'caption',
    ],
    func: async (page, kwargs) => {
        const browserPage = ensurePage(page);
        const target = parseInstagramMediaTarget(String(kwargs.url ?? ''));
        await browserPage.goto(target.canonicalUrl);
        const fetchResult = normalizeFetchResult(await browserPage.evaluate(buildInstagramFetchScript(target.shortcode)));
        if (!fetchResult.ok) {
            handleFetchFailure(fetchResult);
        }
        return [normalizeDetailRow(target, fetchResult.media)];
    },
    __test__: {
        normalizeCaptionText,
        formatPostedAt,
        normalizeMediaNodes,
        normalizeDetailRow,
    },
});
