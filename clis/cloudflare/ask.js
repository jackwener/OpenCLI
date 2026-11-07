import { leeDOM } from './utils.js';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';

const DOMAIN = 'dash.cloudflare.com';
const LOGIN = 'https://dash.cloudflare.com/login';
const COMPOSER = 'textarea[placeholder="Type @ to tag a resource or ? for shortcuts"]';
const UI_HINT = 'Inspect the Ask AI panel in the same remote persona. No prompt was automatically retried.';


async function dom(page, action, value) {
    const result = await page.evaluate(leeDOM, action, value);
    if (result?.error) throw new CommandExecutionError(result.error, UI_HINT);
    return result;
}

async function requireClick(page, action, value) {
    if (!(await dom(page, action, value))?.ok) {
        throw new CommandExecutionError(`Lee control unavailable or ambiguous: ${value || action}`, UI_HINT);
    }
}

function checkState(state) {
    if (new URL(state.url).hostname !== DOMAIN) throw new CommandExecutionError('Left the Cloudflare dashboard', UI_HINT);
    if (state.challenge || state.login) {
        throw new AuthRequiredError(DOMAIN,
            state.challenge ? `Cloudflare security verification blocks ${state.url}` : `Cloudflare login required at ${state.url}`,
            `Sign in and complete verification in the authorized remote persona at ${LOGIN}; no passwords are accepted by this command.`);
    }
    if (state.visibility !== 'visible') throw new CommandExecutionError('Lee requires document.visibilityState=visible', UI_HINT);
}

export async function askLee(page, args) {
    const mode = args.mode ?? 'ask';
    const timeout = args.timeout ?? 180;
    if (!['ask', 'edit'].includes(mode)) throw new ArgumentError('--mode must be ask or edit');
    if (!args.question?.trim()) throw new ArgumentError('A nonempty question is required');
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 900) throw new ArgumentError('--timeout must be 1..900 seconds');
    if (args.zone && !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(args.zone)) throw new ArgumentError('--zone must be a domain name');

    // CDP activates only the caller-owned remote tab. Never spoof visibility or switch OS focus.
    if (typeof page.cdp !== 'function') throw new CommandExecutionError('Lee requires a remote CDP page', 'Use Oracle OpenCLI with an explicit OPENCLI_PERSONA.');
    await page.cdp('Page.bringToFront');
    await page.goto(`https://${DOMAIN}/`);
    await page.cdp('Page.bringToFront');
    let ready = false;
    for (let i = 0; i < 30; i++) {
        const state = await dom(page, 'state');
        checkState(state);
        if (state.composer) { ready = true; break; }
        if (i === 0) await dom(page, 'open');
        await page.wait(1);
        // Ask AI can arrive after dashboard hydration.
        if (i > 0 && i % 5 === 0) await dom(page, 'open');
    }
    if (!ready) throw new CommandExecutionError('Lee composer unavailable; login, entitlement or Lee setup may be required', `Open ${LOGIN} in the same remote persona. This command never creates Lee tokens or changes permissions.`);
    await requireClick(page, 'new');
    await page.wait(1);
    if (!(await dom(page, 'empty')).ok) throw new CommandExecutionError('Lee did not open an empty conversation', UI_HINT);
    await requireClick(page, 'mode');
    await requireClick(page, 'choose', mode === 'edit' ? 'Automatically edit' : 'Ask before editing');
    await page.wait(0.5);
    if (!(await dom(page, 'selected', mode)).ok) throw new CommandExecutionError('Lee mode selection did not take effect', UI_HINT);
    let approved = false;
    // Some versions ask for permission as soon as edit mode is selected.
    if ((await dom(page, 'answer')).approval) {
        if (mode !== 'edit') throw new CommandExecutionError('Lee requested approval; ask mode leaves it unapproved', UI_HINT);
        await requireClick(page, 'approve');
        approved = true;
    }

    const prompt = `${mode === 'ask' ? 'Read-only request. Do not change any Cloudflare resources.\n' : ''}${args.zone ? `Zone: ${args.zone}\n` : ''}${args.question}`;
    await page.fillText(COMPOSER, prompt);
    if (!(await dom(page, 'composer', prompt)).ok) throw new CommandExecutionError('Lee composer did not accept the question', UI_HINT);
    // A single native Enter submits the textarea. No click/send fallback or automatic replay.
    await page.pressKey('ENTER');
    const deadline = Date.now() + timeout * 1000;
    let previous = '';
    let stable = 0;
    while (Date.now() < deadline) {
        checkState(await dom(page, 'state'));
        const result = await dom(page, 'answer');
        if (result.approval) {
            if (mode !== 'edit') throw new CommandExecutionError('Lee requested approval; ask mode leaves it unapproved', 'No change was approved. Only use --mode edit for an explicitly authorized task.');
            // Unknown outcomes must not be retried, even if a stale approval card stays visible.
            if (approved) throw new CommandExecutionError('Lee approval is still visible after one approval', 'Inspect this conversation before issuing another command.');
            await requireClick(page, 'approve');
            approved = true;
        }
        const signature = `${result.worked}\n${result.response}`;
        if (result.worked && result.response && !result.busy && !result.approval) {
            stable = signature === previous ? stable + 1 : 0;
            if (stable >= 2) return [{ response: result.response, worked: result.worked, mode, zone: args.zone || null }];
        } else stable = 0;
        previous = signature;
        await page.wait(1);
    }
    throw new TimeoutError('Lee final answer (Worked completion)', timeout, 'The prompt may have been submitted. Inspect its conversation before retrying; partial text is not returned as success.');
}

export const askCommand = cli({
    site: 'cloudflare', name: 'ask',
    description: 'Ask Cloudflare Agent Lee in a remote dashboard tab (read-only unless --mode edit)',
    domain: DOMAIN, strategy: Strategy.COOKIE, browser: true,
    // Static metadata must cover the edit opt-in and persisted conversation submission.
    access: 'write', navigateBefore: false,
    args: [
        { name: 'question', positional: true, required: true, help: 'Question or explicitly authorized task for Lee' },
        { name: 'zone', type: 'string', help: 'Zone domain included explicitly in the prompt' },
        { name: 'mode', type: 'string', default: 'ask', choices: ['ask', 'edit'], help: 'ask refuses all approvals; edit permits conversation-scoped approval' },
        { name: 'timeout', type: 'int', default: 180, help: 'Seconds to wait for a final Worked response (1..900)' },
    ],
    columns: ['response', 'worked', 'mode', 'zone'], func: askLee,
});
