export interface XhsUserPageSnapshot {
  noteGroups?: unknown;
  pageData?: unknown;
}

export interface XhsUserNoteRow {
  id: string;
  title: string;
  type: string;
  likes: string;
  cover: string;
  url: string;
}

function toCleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

export function normalizeXhsUserId(input: string): string {
  const trimmed = toCleanString(input);
  const withoutQuery = trimmed.replace(/[?#].*$/, '');
  const matched = withoutQuery.match(/\/user\/profile\/([a-zA-Z0-9]+)/);
  if (matched?.[1]) return matched[1];
  return withoutQuery.replace(/\/+$/, '').split('/').pop() ?? withoutQuery;
}

export function flattenXhsNoteGroups(noteGroups: unknown): any[] {
  if (!Array.isArray(noteGroups)) return [];

  const notes: any[] = [];
  for (const group of noteGroups) {
    if (!group) continue;
    if (Array.isArray(group)) {
      for (const item of group) {
        if (item) notes.push(item);
      }
      continue;
    }
    notes.push(group);
  }

  return notes;
}

export function buildXhsNoteUrl(userId: string, noteId: string, xsecToken?: string): string {
  const cleanUserId = toCleanString(userId);
  const cleanNoteId = toCleanString(noteId);
  if (!cleanUserId || !cleanNoteId) return '';

  const url = new URL(`https://www.xiaohongshu.com/user/profile/${cleanUserId}/${cleanNoteId}`);
  const cleanToken = toCleanString(xsecToken);
  if (cleanToken) {
    url.searchParams.set('xsec_token', cleanToken);
    url.searchParams.set('xsec_source', 'pc_user');
  }
  return url.toString();
}

export function extractXhsUserNotes(snapshot: XhsUserPageSnapshot, fallbackUserId: string): XhsUserNoteRow[] {
  const notes = flattenXhsNoteGroups(snapshot.noteGroups);
  const rows: XhsUserNoteRow[] = [];
  const seen = new Set<string>();

  for (const entry of notes) {
    const noteCard = entry?.noteCard ?? entry?.note_card ?? entry;
    if (!noteCard || typeof noteCard !== 'object') continue;

    const noteId = toCleanString(noteCard.noteId ?? noteCard.note_id ?? entry?.noteId ?? entry?.note_id ?? entry?.id);
    if (!noteId || seen.has(noteId)) continue;
    seen.add(noteId);

    const userId = toCleanString(noteCard.user?.userId ?? noteCard.user?.user_id ?? fallbackUserId);
    const xsecToken = toCleanString(entry?.xsecToken ?? entry?.xsec_token ?? noteCard.xsecToken ?? noteCard.xsec_token);
    const likes = toCleanString(noteCard.interactInfo?.likedCount ?? noteCard.interact_info?.liked_count ?? 0) || '0';

    const cover = toCleanString(noteCard.cover?.urlDefault ?? noteCard.cover?.urlPre ?? noteCard.cover?.url ?? '');

    rows.push({
      id: noteId,
      title: toCleanString(noteCard.displayTitle ?? noteCard.display_title ?? noteCard.title),
      type: toCleanString(noteCard.type),
      likes,
      cover,
      url: buildXhsNoteUrl(userId || fallbackUserId, noteId, xsecToken),
    });
  }

  return rows;
}
