import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const PUBLISH_URL = 'https://creator.xiaohongshu.com/publish/publish?from=menu_left&target=image';
export const DRAFT_DB_NAME = 'draft-database-v1';
export const STORE_NAME_MAP = {
    image: 'image-draft',
    video: 'video-draft',
    article: 'article-draft',
    audio: 'audio-draft',
};

export function unwrapBrowserResult(value) {
    if (
        value
        && typeof value === 'object'
        && typeof value.session === 'string'
        && Object.prototype.hasOwnProperty.call(value, 'data')
    ) {
        return value.data;
    }
    return value;
}

export function normalizeDraftType(value, { allowAll = false } = {}) {
    const raw = String(value ?? 'image').trim().toLowerCase();
    if (allowAll && raw === 'all') return raw;
    if (!STORE_NAME_MAP[raw]) {
        const choices = allowAll ? 'image, video, article, audio, all' : Object.keys(STORE_NAME_MAP).join(', ');
        throw new ArgumentError(`Unsupported draft type "${raw}". Expected one of: ${choices}`);
    }
    return raw;
}

export function normalizeDraftId(value) {
    const id = String(value ?? '').trim();
    if (!id) throw new ArgumentError('Draft id is required');
    return id;
}

export function encodeDraftKey(key) {
    const type = typeof key;
    if (type === 'string') return `s:${key}`;
    if (type === 'number') return `n:${String(key)}`;
    if (type === 'boolean') return `b:${String(key)}`;
    try {
        return `j:${encodeURIComponent(JSON.stringify(key))}`;
    }
    catch {
        return `s:${String(key)}`;
    }
}

export function findDraftEntry(entries, id) {
    return entries.find((entry) => encodeDraftKey(entry?.key) === id) || null;
}

export function normalizeDraftRecord(row, key, type, rank, { contentLimit = 80 } = {}) {
    const content = row?.content ?? {};
    const liveContext = content?.contextStore?.liveContext ?? {};
    const draftStore = content?.draftStore ?? {};
    const title = draftStore?.title || liveContext?.title || row?.title || row?.noteTitle || '';
    const editorText = content?.editorContent?.text || content?.editorContent?.plainText || '';
    const updatedAt = row?.updatedAt || row?.updateTime || row?.mtime || content?.updateTime || '';
    const imageCount = draftStore?.imgList?.length
        || content?.noteImageConfig?.items?.length
        || content?.noteImageConfig?.imageList?.length
        || row?.images?.length
        || row?.imageList?.length
        || 0;
    return {
        rank,
        id: encodeDraftKey(key),
        type,
        title: title || '(untitled)',
        updated_at: updatedAt ? String(updatedAt) : '',
        images: imageCount,
        text_preview: String(editorText || '').replace(/\s+/g, ' ').trim().slice(0, contentLimit),
    };
}

export async function ensureDraftDbPage(page) {
    await page.goto(PUBLISH_URL);
    await page.wait({ time: 2 });
}

function draftReadScript(storeName) {
    return `
    (async () => {
      const openDb = () => new Promise((resolve, reject) => {
        const req = indexedDB.open(${JSON.stringify(DRAFT_DB_NAME)});
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('failed to open IndexedDB'));
      });
      try {
        const db = await openDb();
        if (!db.objectStoreNames.contains(${JSON.stringify(storeName)})) {
          db.close();
          return { ok: true, entries: [] };
        }
        const tx = db.transaction(${JSON.stringify(storeName)}, 'readonly');
        const store = tx.objectStore(${JSON.stringify(storeName)});
        const allRows = await new Promise((resolve, reject) => {
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error || new Error('failed to read drafts'));
        });
        const allKeys = await new Promise((resolve, reject) => {
          if (!store.getAllKeys) return resolve([]);
          const req = store.getAllKeys();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error || new Error('failed to read draft keys'));
        });
        db.close();
        return {
          ok: true,
          entries: allRows.map((row, index) => ({ key: allKeys[index] ?? index, row })),
        };
      } catch (error) {
        return { ok: false, error: String(error && error.message || error) };
      }
    })()
  `;
}

export async function readDraftEntries(page, draftType) {
    const storeName = STORE_NAME_MAP[draftType];
    const payload = unwrapBrowserResult(await page.evaluate(draftReadScript(storeName)));
    if (!payload?.ok) {
        throw new CommandExecutionError(payload?.error || `Failed to read ${draftType} drafts`);
    }
    if (!Array.isArray(payload.entries)) {
        throw new CommandExecutionError(`Malformed ${draftType} draft payload`);
    }
    return payload.entries;
}

export function draftNotFound(id, draftType, command) {
    return new EmptyResultError(
        command,
        `Draft ${id} was not found in ${draftType} drafts. Run opencli xiaohongshu drafts --type ${draftType} to list current ids.`,
    );
}
