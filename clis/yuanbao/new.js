import { cli, Strategy } from '@jackwener/opencli/registry';
import { YUANBAO_DOMAIN, YUANBAO_URL, IS_VISIBLE_JS, authRequired, ensureYuanbaoPage, hasLoginGate } from './shared.js';
async function getCurrentUrl(page) {
    const result = await page.evaluate('window.location.href').catch(() => '');
    return typeof result === 'string' ? result : '';
}
async function getComposerText(page) {
    const result = await page.evaluate(`(() => {
    const composer = document.querySelector('.ql-editor, [contenteditable="true"]');
    return composer ? (composer.textContent || '').trim() : '';
  })()`);
    return typeof result === 'string' ? result.trim() : '';
}
async function startNewYuanbaoChat(page) {
    await ensureYuanbaoPage(page);
    if (await hasLoginGate(page))
        return 'blocked';
    const beforeUrl = await getCurrentUrl(page);
    const action = await page.evaluate(`(() => {
    ${IS_VISIBLE_JS}

    const trigger = Array.from(document.querySelectorAll('.yb-common-nav__trigger[data-desc="new-chat"]'))
      .find((node) => isVisible(node));

    if (trigger instanceof HTMLElement) {
      trigger.click();
      return 'clicked';
    }

    return 'navigate';
  })()`);
    if (action === 'navigate') {
        await page.goto(YUANBAO_URL, { waitUntil: 'load', settleMs: 2500 });
        await page.wait(1);
        if (await hasLoginGate(page))
            return 'blocked';
        return 'navigate';
    }
    await page.wait(1);
    if (await hasLoginGate(page))
        return 'blocked';
    const afterUrl = await getCurrentUrl(page);
    const composerText = await getComposerText(page);
    if (afterUrl !== beforeUrl || !composerText)
        return 'clicked';
    await page.goto(YUANBAO_URL, { waitUntil: 'load', settleMs: 2500 });
    await page.wait(1);
    return 'navigate';
}
export const newCommand = cli({
    site: 'yuanbao',
    name: 'new',
    access: 'read',
    description: 'Start a new conversation in Yuanbao web chat',
    domain: YUANBAO_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [],
    columns: ['Status', 'Action'],
    func: async (page) => {
        const action = await startNewYuanbaoChat(page);
        if (action === 'blocked') {
            throw authRequired('Yuanbao opened a login gate instead of starting a new chat.');
        }
        return [{
                Status: 'Success',
                Action: action === 'navigate' ? 'Reloaded Yuanbao homepage as fallback' : 'Clicked New chat',
            }];
    },
});
