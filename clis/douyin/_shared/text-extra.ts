export interface HashtagInfo {
  name: string;
  id: number;
  start: number;
  end: number;
}

export interface TextExtraItem {
  type: number;
  hashtag_id: number;
  hashtag_name: string;
  start: number;
  end: number;
  caption_start: number;
  caption_end: number;
}

export function parseTextExtra(_text: string, hashtags: HashtagInfo[]): TextExtraItem[] {
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
export function extractHashtagNames(text: string): string[] {
  return [...text.matchAll(/#([^\s#]+)/g)].map((m) => m[1]);
}
