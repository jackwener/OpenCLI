/**
 * Transcript grouping: sentence merging, speaker detection, and chapter support.
 * Ported and simplified from Defuddle's YouTube extractor.
 *
 * Raw segments (2-3 second fragments) are grouped into readable paragraphs:
 * - Sentence boundaries: merge until sentence-ending punctuation (.!?)
 * - Speaker turns: detect ">>" markers from YouTube auto-captions
 * - Chapters: optional chapter headings inserted at appropriate timestamps
 */

// Include CJK sentence-ending punctuation: 。！？ (fullwidth: ．！？)
const SENTENCE_END = /[.!?\u3002\uFF01\uFF1F\uFF0E]["'\u2019\u201D)]*\s*$/;
const QUESTION_END = /[?\uFF1F]["'\u2019\u201D)]*\s*$/;
const TRANSCRIPT_GROUP_GAP_SECONDS = 20;
const TURN_MERGE_MAX_WORDS = 80;
const TURN_MERGE_MAX_SPAN_SECONDS = 45;
const SHORT_UTTERANCE_MAX_WORDS = 3;
const FIRST_GROUP_MERGE_MIN_WORDS = 8;

export interface RawSegment {
  start: number;
  end: number;
  text: string;
}

export interface GroupedSegment {
  start: number;
  text: string;
  speakerChange: boolean;
  speaker?: number;
}

export interface Chapter {
  title: string;
  start: number;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Group raw transcript segments into readable blocks.
 * If speaker markers (>>) are present, groups by speaker turn.
 * Otherwise, groups by sentence boundaries.
 */
export function groupTranscriptSegments(
  segments: { start: number; text: string }[],
): GroupedSegment[] {
  if (segments.length === 0) return [];
  const hasSpeakerMarkers = segments.some(s => /^>>/.test(s.text));
  return hasSpeakerMarkers ? groupBySpeaker(segments) : groupBySentence(segments);
}

/**
 * Format grouped segments + chapters into a final text output.
 */
export function formatGroupedTranscript(
  segments: GroupedSegment[],
  chapters: Chapter[] = [],
): { rows: Array<{ timestamp: string; speaker: string; text: string }>; plainText: string } {
  const sortedChapters = [...chapters].sort((a, b) => a.start - b.start);
  let chapterIdx = 0;

  const rows: Array<{ timestamp: string; speaker: string; text: string }> = [];
  const textParts: string[] = [];

  for (const segment of segments) {
    // Insert chapter headings
    while (chapterIdx < sortedChapters.length && sortedChapters[chapterIdx].start <= segment.start) {
      const title = sortedChapters[chapterIdx].title;
      rows.push({ timestamp: fmtTime(sortedChapters[chapterIdx].start), speaker: '', text: `[Chapter] ${title}` });
      if (textParts.length > 0) textParts.push('');
      textParts.push(`### ${title}`);
      textParts.push('');
      chapterIdx++;
    }

    const timestamp = fmtTime(segment.start);
    const speaker = segment.speaker !== undefined ? `Speaker ${segment.speaker + 1}` : '';

    rows.push({ timestamp, speaker, text: segment.text });

    if (segment.speakerChange && textParts.length > 0) {
      textParts.push('');
    }
    textParts.push(`${timestamp} ${segment.text}`);
  }

  return { rows, plainText: textParts.join('\n') };
}

function fmtTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── Sentence grouping ─────────────────────────────────────────────────────

// Max time span (seconds) for a single group when no sentence boundaries are found.
// Prevents unbounded merging for languages without punctuation (Chinese, etc.).
const MAX_GROUP_SPAN_SECONDS = 30;

function groupBySentence(
  segments: { start: number; text: string }[],
): GroupedSegment[] {
  const groups: GroupedSegment[] = [];
  let buffer = '';
  let bufferStart = 0;
  let lastStart = 0;

  const flush = () => {
    if (buffer.trim()) {
      groups.push({ start: bufferStart, text: buffer.trim(), speakerChange: false });
      buffer = '';
    }
  };

  for (const seg of segments) {
    // Large gap between segments — always flush
    if (buffer && seg.start - lastStart > TRANSCRIPT_GROUP_GAP_SECONDS) {
      flush();
    }
    // Time-based flush: prevent unbounded groups for unpunctuated languages
    if (buffer && seg.start - bufferStart > MAX_GROUP_SPAN_SECONDS) {
      flush();
    }
    if (!buffer) bufferStart = seg.start;
    buffer += (buffer ? ' ' : '') + seg.text;
    lastStart = seg.start;
    if (SENTENCE_END.test(seg.text)) flush();
  }
  flush();
  return groups;
}

// ── Speaker grouping ──────────────────────────────────────────────────────

function groupBySpeaker(
  segments: { start: number; text: string }[],
): GroupedSegment[] {
  type Turn = {
    start: number;
    segments: { start: number; text: string }[];
    speakerChange: boolean;
    speaker?: number;
  };

  const turns: Turn[] = [];
  let currentTurn: Turn | null = null;
  let speakerIndex = -1;
  let prevSegText = '';

  for (const seg of segments) {
    const isSpeakerChange = /^>>/.test(seg.text);
    const cleanText = seg.text.replace(/^>>\s*/, '').replace(/^-\s+/, '');

    const prevEndsWithComma = /,\s*$/.test(prevSegText);
    const prevEndedSentence = (SENTENCE_END.test(prevSegText) || !prevSegText) && !prevEndsWithComma;
    const isRealSpeakerChange = isSpeakerChange && prevEndedSentence;

    if (isRealSpeakerChange) {
      if (currentTurn) turns.push(currentTurn);
      speakerIndex = (speakerIndex + 1) % 2;
      currentTurn = {
        start: seg.start,
        segments: [{ start: seg.start, text: cleanText }],
        speakerChange: true,
        speaker: speakerIndex,
      };
    } else {
      if (!currentTurn) {
        currentTurn = { start: seg.start, segments: [], speakerChange: false };
      }
      currentTurn.segments.push({ start: seg.start, text: cleanText });
    }
    prevSegText = cleanText;
  }
  if (currentTurn) turns.push(currentTurn);

  splitAffirmativeTurns(turns);

  const groups: GroupedSegment[] = [];
  for (const turn of turns) {
    const sentenceGroups = turn.speaker === undefined
      ? groupBySentence(turn.segments)
      : mergeSentenceGroupsWithinTurn(groupBySentence(turn.segments));
    for (let i = 0; i < sentenceGroups.length; i++) {
      groups.push({
        ...sentenceGroups[i],
        speakerChange: i === 0 && turn.speakerChange,
        speaker: turn.speaker,
      });
    }
  }
  return groups;
}

function splitAffirmativeTurns(turns: Array<{
  start: number;
  segments: { start: number; text: string }[];
  speakerChange: boolean;
  speaker?: number;
}>): void {
  const affirmativePattern = /^(mhm|yeah|yes|yep|right|okay|ok|absolutely|sure|exactly|uh-huh|mm-hmm)[.!,]?\s+/i;

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    if (turn.speaker === undefined || turn.segments.length === 0) continue;

    const firstSeg = turn.segments[0];
    const match = affirmativePattern.exec(firstSeg.text);
    if (!match) continue;
    if (/,\s*$/.test(match[0])) continue;

    const remainder = firstSeg.text.slice(match[0].length).trim();
    const restSegments = turn.segments.slice(1);
    const restWords = countWords(remainder) + restSegments.reduce((sum, s) => sum + countWords(s.text), 0);
    if (restWords < 30) continue;

    const affirmativeText = match[0].trimEnd();
    const newRestSegments = remainder
      ? [{ start: firstSeg.start, text: remainder }, ...restSegments]
      : restSegments;

    turns.splice(i, 1, {
      start: turn.start,
      segments: [{ start: firstSeg.start, text: affirmativeText }],
      speakerChange: turn.speakerChange,
      speaker: turn.speaker,
    }, {
      start: newRestSegments[0].start,
      segments: newRestSegments,
      speakerChange: true,
      speaker: turn.speaker === 0 ? 1 : 0,
    });
    i++;
  }
}

function mergeSentenceGroupsWithinTurn(groups: GroupedSegment[]): GroupedSegment[] {
  if (groups.length <= 1) return groups;

  const merged: GroupedSegment[] = [];
  let current = { ...groups[0] };
  let currentIsFirstInTurn = true;

  for (let i = 1; i < groups.length; i++) {
    const next = groups[i];
    if (shouldMergeSentenceGroups(current, next, currentIsFirstInTurn)) {
      current.text = `${current.text} ${next.text}`;
      continue;
    }
    merged.push(current);
    current = { ...next };
    currentIsFirstInTurn = false;
  }
  merged.push(current);
  return merged;
}

function shouldMergeSentenceGroups(
  current: { start: number; text: string },
  next: { start: number; text: string },
  currentIsFirstInTurn: boolean,
): boolean {
  const currentWords = countWords(current.text);
  const nextWords = countWords(next.text);

  if (isShortStandaloneUtterance(current.text, currentWords)
    || isShortStandaloneUtterance(next.text, nextWords)) return false;
  if (currentIsFirstInTurn && currentWords < FIRST_GROUP_MERGE_MIN_WORDS) return false;
  if (QUESTION_END.test(current.text) || QUESTION_END.test(next.text)) return false;
  if (currentWords + nextWords > TURN_MERGE_MAX_WORDS) return false;
  if (next.start - current.start > TURN_MERGE_MAX_SPAN_SECONDS) return false;
  return true;
}

function isShortStandaloneUtterance(text: string, words?: number): boolean {
  const w = words ?? countWords(text);
  return w > 0 && w <= SHORT_UTTERANCE_MAX_WORDS && SENTENCE_END.test(text);
}
