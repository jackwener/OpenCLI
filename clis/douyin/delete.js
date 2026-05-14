import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { browserFetch } from './_shared/browser-fetch.js';

const CREATOR_MANAGE_URL = 'https://creator.douyin.com/creator-micro/content/manage';
const WORK_LIST_URL = '/janus/douyin/creator/pc/work_list?status=0&count=20&max_cursor=0&scene=star_atlas&device_platform=android&aid=1128';

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function deleteViaCreatorManage(page, workId) {
    await page.goto(CREATOR_MANAGE_URL);
    await sleep(3000);
    await sleep(3000);
    const result = await page.evaluate(`
    (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const targetId = ${JSON.stringify(String(workId))};
      const textOf = (node) => (node && (node.innerText || node.textContent) || '').trim();
      const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();

      async function loadTarget() {
        const res = await fetch(${JSON.stringify(WORK_LIST_URL)}, { credentials: 'include' });
        const payload = await res.json();
        const list = Array.isArray(payload.aweme_list) ? payload.aweme_list : [];
        const matches = list
          .map((entry, index) => ({ entry, index }))
          .filter(({ entry }) => String(entry.aweme_id || '') === targetId || String(entry.item_id || '') === targetId);
        if (matches.length === 0) {
          return { ok: false, reason: 'not_found', status_code: payload.status_code, count: list.length };
        }
        if (matches.length !== 1) {
          return { ok: false, reason: 'target_not_unique', count: matches.length };
        }
        const { entry: item, index } = matches[0];
        const title = normalize(item.desc || item.caption || item.title || item.item_title || '');
        return { ok: true, item, index, listCount: list.length, title };
      }

      function visibleWorkCards() {
        const candidates = Array.from(document.querySelectorAll('[class*="video-card"]'))
          .filter((element) => {
            const text = normalize(textOf(element));
            return text.includes('删除作品') && text.includes('继续编辑');
          });
        return candidates.filter((candidate) => !candidates.some((other) => other !== candidate && other.contains(candidate)));
      }

      const target = await loadTarget();
      if (!target.ok) return target;

      const allTab = Array.from(document.querySelectorAll('button,[role="button"],span,div'))
        .find((element) => /^全部作品$/.test(normalize(textOf(element))));
      allTab?.click();
      await sleep(1000);
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const cards = visibleWorkCards();
        if (cards.length >= target.listCount && cards[target.index]) {
          const card = cards[target.index];
          const deleteButton = Array.from(card.querySelectorAll('button,[role="button"],span,div'))
            .find((element) => /^删除作品$/.test(normalize(textOf(element))));
          if (!deleteButton) return { ok: false, reason: 'delete_button_not_found', aweme_id: target.item.aweme_id, item_id: target.item.item_id, index: target.index, cardCount: cards.length };
          deleteButton.click();
          await sleep(800);
          const confirmButton = Array.from(document.querySelectorAll('button,[role="button"]'))
            .find((element) => ['确定', '确认', '删除'].includes(normalize(textOf(element))));
          if (!confirmButton) return { ok: false, reason: 'confirm_button_not_found', aweme_id: target.item.aweme_id, item_id: target.item.item_id };
          confirmButton.click();
          for (let wait = 0; wait < 20; wait += 1) {
            await sleep(500);
            const after = await loadTarget();
            if (!after.ok && after.reason === 'not_found') {
              return { ok: true, aweme_id: target.item.aweme_id, item_id: target.item.item_id, title: target.title };
            }
          }
          return { ok: false, reason: 'delete_not_confirmed', aweme_id: target.item.aweme_id, item_id: target.item.item_id };
        }
        await sleep(500);
      }
      return { ok: false, reason: 'card_not_found', aweme_id: target.item.aweme_id, item_id: target.item.item_id, index: target.index, listCount: target.listCount };
    })()
  `);

    if (!result?.ok) {
        throw new CommandExecutionError(`抖音后台管理删除失败: ${JSON.stringify(result)}`);
    }
    return result;
}

cli({
    site: 'douyin',
    name: 'delete',
    access: 'write',
    description: '删除作品（优先使用创作者后台作品管理；找不到时回退到旧删除接口）',
    domain: 'creator.douyin.com',
    strategy: Strategy.COOKIE,
    siteSession: 'persistent',
    args: [
        { name: 'aweme_id', required: true, positional: true, help: '作品 ID / item_id' },
    ],
    columns: ['status'],
    func: async (page, kwargs) => {
        try {
            const deleted = await deleteViaCreatorManage(page, kwargs.aweme_id);
            return [{ status: `✅ 已通过后台管理删除 ${deleted.aweme_id || kwargs.aweme_id}` }];
        } catch (fallbackError) {
            const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
            if (!fallbackMessage.includes('"reason":"not_found"')) {
                throw fallbackError;
            }
        }

        const url = 'https://creator.douyin.com/web/api/media/aweme/delete/?aid=1128';
        await browserFetch(page, 'POST', url, { body: { aweme_id: kwargs.aweme_id }, timeoutMs: 8000 });
        return [{ status: `✅ 已删除 ${kwargs.aweme_id}` }];
    },
});
