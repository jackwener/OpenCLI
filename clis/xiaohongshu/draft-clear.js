import { CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    DRAFT_DB_NAME,
    STORE_NAME_MAP,
    ensureDraftDbPage,
    normalizeDraftType,
    unwrapBrowserResult,
} from './draft-utils.js';

function clearDraftsScript(storeNames, execute) {
    return `
    (async () => {
      const openDb = () => new Promise((resolve, reject) => {
        const req = indexedDB.open(${JSON.stringify(DRAFT_DB_NAME)});
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('failed to open IndexedDB'));
      });
      const countStore = (db, storeName) => new Promise((resolve, reject) => {
        if (!db.objectStoreNames.contains(storeName)) return resolve(0);
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.count();
        req.onsuccess = () => resolve(req.result || 0);
        req.onerror = () => reject(req.error || new Error('failed to count drafts'));
        tx.onerror = () => reject(tx.error || new Error('failed to count drafts'));
      });
      const clearStore = (db, storeName) => new Promise((resolve, reject) => {
        if (!db.objectStoreNames.contains(storeName)) return resolve(true);
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.clear();
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error || new Error('failed to clear drafts'));
        tx.onerror = () => reject(tx.error || new Error('failed to clear drafts'));
      });
      try {
        const db = await openDb();
        const storeNames = ${JSON.stringify(storeNames)};
        let before = 0;
        for (const storeName of storeNames) before += await countStore(db, storeName);
        if (${JSON.stringify(execute)}) {
          for (const storeName of storeNames) await clearStore(db, storeName);
          let after = 0;
          for (const storeName of storeNames) after += await countStore(db, storeName);
          db.close();
          return { ok: true, before, after, cleared: before - after };
        }
        db.close();
        return { ok: true, before, after: before, cleared: 0 };
      } catch (error) {
        return { ok: false, error: String(error && error.message || error) };
      }
    })()
  `;
}

cli({
    site: 'xiaohongshu',
    name: 'draft-clear',
    access: 'write',
    description: '清空小红书本地草稿',
    domain: 'creator.xiaohongshu.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'type', default: 'image', help: 'Draft type: image, video, article, audio, all' },
        { name: 'execute', type: 'bool', default: false, help: 'Actually clear local drafts. Default is dry-run count only.' },
    ],
    columns: ['status', 'type', 'count', 'message'],
    func: async (page, kwargs) => {
        const draftType = normalizeDraftType(kwargs.type, { allowAll: true });
        const execute = kwargs.execute === true;
        const storeNames = draftType === 'all' ? Object.values(STORE_NAME_MAP) : [STORE_NAME_MAP[draftType]];
        await ensureDraftDbPage(page);
        const result = unwrapBrowserResult(await page.evaluate(clearDraftsScript(storeNames, execute)));
        if (!result?.ok) {
            throw new CommandExecutionError(result?.error || `Failed to ${execute ? 'clear' : 'count'} ${draftType} drafts`);
        }
        if (execute && Number(result.after) !== 0) {
            throw new CommandExecutionError(`${result.after} ${draftType} drafts still exist after clear`);
        }
        return [{
            status: execute ? 'cleared' : 'dry-run',
            type: draftType,
            count: execute ? Number(result.cleared || 0) : Number(result.before || 0),
            message: execute ? 'Drafts cleared.' : 'Drafts counted. Re-run with --execute to clear.',
        }];
    },
});
