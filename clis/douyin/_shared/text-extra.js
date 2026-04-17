export function parseTextExtra(_text, hashtags) {
    return hashtags.map((h) => ({
        type: 1,
        hashtag_id: h.id,
        hashtag_name: h.name,
        start: h.start,
        end: h.end,
        caption_start: 0,
        caption_end: h.end - h.start,
    }));
}
/** Extract hashtag names from text (e.g. "#话题" → ["话题"]) */
export function extractHashtagNames(text) {
    return [...text.matchAll(/#([^\s#]+)/g)].map((m) => m[1]);
}
