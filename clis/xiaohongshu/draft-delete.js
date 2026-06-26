import { CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    DRAFT_DB_NAME,
    STORE_NAME_MAP,
    draftNotFound,
    ensureDraftDbPage,
    findDraftEntry,
    normalizeDraftId,
    normalizeDraftRecord,
    normalizeDraftType,
    readDraftEntries,
    unwrapBrowserResult,
} from './draft-utils.js';

function deleteDraftScript(storeName, key) {
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
          return { ok: false, error: 'draft store not found' };
        }
        const key = ${JSON.stringify(key)};
        await new Promise((resolve, reject) => {
          const tx = db.transaction(${JSON.stringify(storeName)}, 'readwrite');
          const store = tx.objectStore(${JSON.stringify(storeName)});
          const req = store.delete(key);
          req.onsuccess = () => resolve(true);
          req.onerror = () => reject(req.error || new Error('failed to delete draft'));
          tx.onerror = () => reject(tx.error || new Error('failed to delete draft'));
        });
        const after = await new Promise((resolve, reject) => {
          const tx = db.transaction(${JSON.stringify(storeName)}, 'readonly');
          const store = tx.objectStore(${JSON.stringify(storeName)});
          const req = store.get(key);
          req.onsuccess = () => resolve(req.result ?? null);
          req.onerror = () => reject(req.error || new Error('failed to verify draft delete'));
          tx.onerror = () => reject(tx.error || new Error('failed to verify draft delete'));
        });
        db.close();
        return { ok: true, deleted: after === null };
      } catch (error) {
        return { ok: false, error: String(error && error.message || error) };
      }
    })()
  `;
}

cli({
    site: 'xiaohongshu',
    name: 'draft-delete',
    access: 'write',
    description: '删除一条小红书本地草稿',
    domain: 'creator.xiaohongshu.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'Draft id returned by `opencli xiaohongshu drafts`' },
        { name: 'type', default: 'image', help: 'Draft type: image, video, article, audio' },
        { name: 'execute', type: 'bool', default: false, help: 'Actually delete the local draft. Default is dry-run verification only.' },
    ],
    columns: ['status', 'id', 'type', 'message'],
    func: async (page, kwargs) => {
        const id = normalizeDraftId(kwargs.id);
        const draftType = normalizeDraftType(kwargs.type);
        const execute = kwargs.execute === true;
        await ensureDraftDbPage(page);
        const entries = await readDraftEntries(page, draftType);
        const entry = findDraftEntry(entries, id);
        if (!entry) throw draftNotFound(id, draftType, 'xiaohongshu/draft-delete');
        const row = normalizeDraftRecord(entry.row, entry.key, draftType, 1);
        if (!execute) {
            return [{
                status: 'dry-run',
                id: row.id,
                type: draftType,
                message: 'Draft exists. Re-run with --execute to delete.',
            }];
        }
        const storeName = STORE_NAME_MAP[draftType];
        const result = unwrapBrowserResult(await page.evaluate(deleteDraftScript(storeName, entry.key)));
        if (!result?.ok) {
            throw new CommandExecutionError(result?.error || `Failed to delete draft ${row.id}`);
        }
        if (!result.deleted) {
            throw new CommandExecutionError(`Draft ${row.id} still exists after delete`);
        }
        return [{
            status: 'deleted',
            id: row.id,
            type: draftType,
            message: 'Draft deleted.',
        }];
    },
});
