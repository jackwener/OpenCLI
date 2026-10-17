import { AuthRequiredError, CliError, CommandExecutionError } from '@jackwener/opencli/errors';

export function taobaoPageState() {
    const url = new URL(location.href);
    const title = (document.title || '').trim();
    const challengeVisible = Array.from(document.querySelectorAll('#nocaptcha, #nc_1_wrapper, #baxia-dialog-content')).some(node => {
        if (node.closest('[hidden], [aria-hidden="true"]')) return false;
        for (let parent = node; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent);
            if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) === 0) return false;
        }
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    });
    // Inspect routing and dedicated challenge UI, not product descriptions.
    if (/(?:^|\/)(?:punish|captcha|verify)(?:\/|$)/i.test(url.pathname)
        || url.searchParams.has('_____tmd_____') || url.searchParams.has('x5sec')
        || /安全验证|滑块验证|访问受限|账号异常|账户异常|captcha|security verification/i.test(title)
        || challengeVisible) {
        return 'blocked';
    }
    if (/^(?:login|passport)\.(?:taobao|tmall|alibaba)\.com$/i.test(url.hostname)
        || /^(?:登录|登入)(?:\s|[-_—]|$)/.test(title)
        || /\/member\/login\.jhtml$/.test(url.pathname)) return 'login';
    return 'ok';
}

export function requireTaobaoPageState(state) {
    if (state === 'blocked') throw new CliError('SECURITY_BLOCK', 'Taobao requires security verification.', 'Stop and resolve the verification in your browser; the command was not retried.');
    if (state === 'login') throw new AuthRequiredError('taobao.com', 'Taobao requires login; the command was not retried.');
    if (state !== 'ok') throw new CommandExecutionError('Could not verify the Taobao page state.');
}

export async function assertTaobaoPageUsable(page) {
    requireTaobaoPageState(await page.evaluate(`(${taobaoPageState.toString()})()`));
}
