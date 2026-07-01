export const COMPOSE_URL = 'https://x.com/compose/post';

export async function openScheduledQueue(page) {
    await page.goto(COMPOSE_URL, { waitUntil: 'load', settleMs: 2500 });
    await page.wait({ selector: '[data-testid="unsentButton"]', timeout: 15 });
    const opened = await page.evaluate(`(async () => {
        const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
        const drafts = Array.from(document.querySelectorAll('[data-testid="unsentButton"], button,[role="button"]'))
            .find((el) => visible(el) && /drafts/i.test(el.textContent || ''));
        if (!drafts) return { ok: false, message: 'Could not find Drafts button in composer.' };
        drafts.click();
        return { ok: true };
    })()`);
    if (!opened?.ok) return opened;

    await page.wait(1);
    const selected = await page.evaluate(`(async () => {
        const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
        const scheduledTab = Array.from(document.querySelectorAll('a, [role="tab"]'))
            .find((el) => visible(el) && /^scheduled$/i.test((el.textContent || '').trim()));
        if (!scheduledTab) return { ok: false, message: 'Could not find Scheduled tab in Drafts.' };
        scheduledTab.click();
        return { ok: true };
    })()`);
    if (!selected?.ok) return selected;

    await page.wait(2);
    return { ok: true };
}
