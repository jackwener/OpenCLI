/**
 * Xiaohongshu Creator Notes Summary — batch summary for recent notes.
 *
 * Combines creator-notes and creator-note-detail into a single command that
 * returns one summary row per note, suitable for quick review or downstream JSON use.
 */

import { cli, Strategy } from '../../registry.js';
import { fetchCreatorNotes, type CreatorNoteRow } from './creator-notes.js';
import { fetchCreatorNoteDetailRows, type CreatorNoteDetailRow } from './creator-note-detail.js';

type CreatorNoteSummaryRow = {
  rank: number;
  id: string;
  title: string;
  published_at: string;
  views: string;
  likes: string;
  collects: string;
  comments: string;
  shares: string;
  avg_view_time: string;
  rise_fans: string;
  top_source: string;
  top_source_pct: string;
  top_interest: string;
  top_interest_pct: string;
  url: string;
};

function findDetailValue(rows: CreatorNoteDetailRow[], metric: string): string {
  return rows.find((row) => row.metric === metric)?.value ?? '';
}

function findTopBySectionPrefix(rows: CreatorNoteDetailRow[], section: string, prefix: string): { label: string; value: string } {
  const matches = rows.filter((row) => row.section === section && row.metric.startsWith(prefix) && row.value);
  if (matches.length === 0) return { label: '', value: '' };
  const sorted = [...matches].sort((a, b) => parseFloat(b.value) - parseFloat(a.value));
  const top = sorted[0];
  return {
    label: top.metric.slice(prefix.length),
    value: top.value,
  };
}

export function summarizeCreatorNote(note: CreatorNoteRow, rows: CreatorNoteDetailRow[], rank: number): CreatorNoteSummaryRow {
  const topSource = findTopBySectionPrefix(rows, '观看来源', '');
  const topInterest = findTopBySectionPrefix(rows, '观众画像', '兴趣/');

  return {
    rank,
    id: note.id,
    title: note.title,
    published_at: findDetailValue(rows, 'published_at') || note.date,
    views: findDetailValue(rows, '观看数') || String(note.views),
    likes: findDetailValue(rows, '点赞数') || String(note.likes),
    collects: findDetailValue(rows, '收藏数') || String(note.collects),
    comments: findDetailValue(rows, '评论数') || String(note.comments),
    shares: findDetailValue(rows, '分享数'),
    avg_view_time: findDetailValue(rows, '平均观看时长'),
    rise_fans: findDetailValue(rows, '涨粉数'),
    top_source: topSource.label,
    top_source_pct: topSource.value,
    top_interest: topInterest.label,
    top_interest_pct: topInterest.value,
    url: note.url,
  };
}

cli({
  site: 'xiaohongshu',
  name: 'creator-notes-summary',
  description: '小红书最近笔记批量摘要 (列表 + 单篇关键数据汇总)',
  domain: 'creator.xiaohongshu.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'limit', type: 'int', default: 3, help: 'Number of recent notes to summarize' },
  ],
  columns: ['rank', 'id', 'title', 'views', 'likes', 'collects', 'comments', 'shares', 'avg_view_time', 'rise_fans', 'top_source', 'top_interest', 'url'],
  timeoutSeconds: 180,
  func: async (page, kwargs) => {
    const limit = kwargs.limit || 3;
    const notes = await fetchCreatorNotes(page, limit);

    if (!notes.length) {
      throw new Error('No notes found. Are you logged into creator.xiaohongshu.com?');
    }

    const results: CreatorNoteSummaryRow[] = [];
    for (const [index, note] of notes.entries()) {
      if (!note.id) {
        results.push({
          rank: index + 1,
          id: note.id,
          title: note.title,
          published_at: note.date,
          views: String(note.views),
          likes: String(note.likes),
          collects: String(note.collects),
          comments: String(note.comments),
          shares: '',
          avg_view_time: '',
          rise_fans: '',
          top_source: '',
          top_source_pct: '',
          top_interest: '',
          top_interest_pct: '',
          url: note.url,
        });
        continue;
      }

      const detailRows = await fetchCreatorNoteDetailRows(page, note.id);
      results.push(summarizeCreatorNote(note, detailRows, index + 1));
    }

    return results;
  },
});
