import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import {
    CHATGPT_DOMAIN,
    CHATGPT_URL,
    ensureChatGPTLogin,
    unwrapEvaluateResult,
} from './utils.js';

// 2026-10: Settings > Plugins lists installed apps; an app's panel has a
// Refresh button (re-reads its MCP tool list) and a "Plugin actions" menu
// (View plugin detail, Edit name, Edit description, Disconnect, Delete).
// A disconnected app leaves that list and the plugin catalog, so it is
// reconnected from its own page, /plugins/<plugin id>, by "Install plugin".
const PLUGIN_ID_RE = /plugin_[A-Za-z0-9_]+/;
// A query that changes on every call forces a real load: a reused tab that
// only changes its #hash keeps the old panel state (2026-10-08).
const settingsUrl = (panel) => `${CHATGPT_URL}/?opencli=${Date.now()}#settings/${panel}`;

export function parsePluginId(value) {
    const match = String(value || '').match(PLUGIN_ID_RE);
    return match ? match[0] : '';
}

// Page-level events reach React even when the window is in the background.
const CLICK_JS = `const press = (el) => {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    el.click();
};`;

async function evaluate(page, js) {
    return unwrapEvaluateResult(await page.evaluate(js));
}

async function openAppPanel(page, name) {
    await page.goto(settingsUrl('Connectors'), { settleMs: 2500 });
    await ensureChatGPTLogin(page);
    // The installed list renders a few seconds after the dialog.
    for (let attempt = 0; attempt < 12; attempt++) {
        const opened = await evaluate(page, `(() => {
            ${CLICK_JS}
            const dialog = Array.from(document.querySelectorAll('[role=dialog]')).pop();
            if (!dialog) return 'no-dialog';
            const label = Array.from(dialog.querySelectorAll('*'))
                .find((el) => el.children.length === 0 && el.textContent.trim() === ${JSON.stringify(name)});
            if (!label) {
                // The installed list mounts only when scrolled into view.
                dialog.querySelectorAll('*').forEach((el) => { if (el.scrollHeight > el.clientHeight + 10) el.scrollTop = el.scrollHeight; });
                return 'no-app: ' + document.visibilityState + ' ' + location.href + ' :: ' + dialog.innerText.split('\\n').join(' / ').slice(-300);
            }
            press(label.closest('button,a,[role=button],li,div[tabindex]') || label);
            return 'opened';
        })()`);
        if (opened === 'opened') {
            await page.sleep(3);
            return;
        }
        if (String(opened).startsWith('no-app') && attempt >= 8) {
            throw new CommandExecutionError(
                `No installed ChatGPT app named "${name}" in Settings > Plugins (${opened}).`,
                'A disconnected app is not listed: run `opencli chatgpt app <plugin id> connect` with the id `disconnect` printed.');
        }
        await page.sleep(1);
    }
    throw new CommandExecutionError('ChatGPT settings did not open.');
}

async function appPanelTools(page) {
    const tools = await evaluate(page, `(() => {
        const dialog = Array.from(document.querySelectorAll('[role=dialog]')).pop();
        if (!dialog) return [];
        const lines = dialog.innerText.split('\\n').map((line) => line.trim());
        const names = [];
        lines.forEach((line, index) => {
            if (/^[a-z][a-z0-9_]+$/.test(line) && /^(READ|WRITE)$/.test(lines[index + 1] || '')) names.push(line);
        });
        return names;
    })()`);
    return Array.isArray(tools) ? tools : [];
}

async function pressPanelButton(page, label) {
    const pressed = await evaluate(page, `(() => {
        ${CLICK_JS}
        const dialog = Array.from(document.querySelectorAll('[role=dialog]')).pop();
        const button = dialog && Array.from(dialog.querySelectorAll('button'))
            .find((b) => b.textContent.replace(/\\s+/g, ' ').trim() === ${JSON.stringify(label)});
        if (!button) return false;
        press(button);
        return true;
    })()`);
    if (!pressed) throw new CommandExecutionError(`The app panel has no "${label}" button.`);
}

async function chooseAppAction(page, item) {
    const opened = await evaluate(page, `(() => {
        ${CLICK_JS}
        const dialog = Array.from(document.querySelectorAll('[role=dialog]')).pop();
        const button = dialog && Array.from(dialog.querySelectorAll('button'))
            .find((b) => b.getAttribute('aria-label') === 'Plugin actions');
        if (!button) return false;
        press(button);
        return true;
    })()`);
    if (!opened) throw new CommandExecutionError('The app panel has no "Plugin actions" menu.');
    await page.sleep(1.5);
    const chosen = await evaluate(page, `(() => {
        ${CLICK_JS}
        const entry = Array.from(document.querySelectorAll('[role=menuitem]'))
            .find((el) => el.textContent.trim() === ${JSON.stringify(item)});
        if (!entry) return Array.from(document.querySelectorAll('[role=menuitem]')).map((el) => el.textContent.trim()).join(', ') || 'none';
        press(entry);
        return 'ok';
    })()`);
    if (chosen !== 'ok') throw new CommandExecutionError(`The "Plugin actions" menu has no "${item}"; it offers: ${chosen}`);
    await page.sleep(3);
}

async function refreshApp(page, name) {
    await openAppPanel(page, name);
    const state = await waitForPanel(page, ['connected', 'disconnected'], 10);
    if (state === 'disconnected') throw new CommandExecutionError(`"${name}" is installed but not connected; run \`opencli chatgpt app <plugin id> connect\`.`);
    const before = await appPanelTools(page);
    await pressPanelButton(page, 'Refresh');
    await page.sleep(10);
    const after = await appPanelTools(page);
    if (after.length === 0) throw new CommandExecutionError(`"${name}" shows no tools after Refresh.`);
    const added = after.filter((tool) => !before.includes(tool));
    const removed = before.filter((tool) => !after.includes(tool));
    return { Status: 'Refreshed', App: name, Plugin: '', Tools: after.length, Changed: [...added.map((t) => `+${t}`), ...removed.map((t) => `-${t}`)].join(' ') };
}

async function disconnectApp(page, name) {
    await openAppPanel(page, name);
    await chooseAppAction(page, 'View plugin detail');
    const plugin = parsePluginId(await evaluate(page, 'window.location.href'));
    if (!plugin) throw new CommandExecutionError(`Could not read "${name}"'s plugin id, so it would not be reconnectable; nothing was disconnected.`);
    await openAppPanel(page, name);
    await chooseAppAction(page, 'Disconnect');
    // The open panel updates late; a fresh load of the app's panel is the check.
    await page.sleep(3);
    await page.goto(settingsUrl(`Plugins/${plugin}`), { settleMs: 3000 });
    if (await waitForPanel(page, ['disconnected', 'connected'], 12) !== 'disconnected') throw new CommandExecutionError(`"${name}" did not show Connect after Disconnect; check Settings > Plugins.`);
    return { Status: 'Disconnected', App: name, Plugin: plugin, Tools: '', Changed: `reconnect: opencli chatgpt app ${plugin} connect` };
}

async function pluginPageState(page) {
    return evaluate(page, `(() => {
        const labels = Array.from(document.querySelectorAll('main button, main a')).map((b) => b.textContent.trim());
        if (labels.includes('Try in chat')) return 'connected';
        if (labels.includes('Install plugin')) return 'disconnected';
        return 'unknown';
    })()`);
}

// The app panel's state: 'connected' (Refresh is offered), 'disconnected'
// (Connection: Connect), or 'unknown' while it loads.
async function panelConnection(page) {
    return evaluate(page, `(() => {
        const dialog = Array.from(document.querySelectorAll('[role=dialog]')).pop();
        if (!dialog) return 'unknown';
        const labels = Array.from(dialog.querySelectorAll('button')).map((b) => b.textContent.replace(/\\s+/g, ' ').trim());
        if (labels.includes('Refresh')) return 'connected';
        if (labels.some((label) => /Connect$/.test(label))) return 'disconnected';
        return 'unknown';
    })()`);
}

async function waitForPanel(page, wanted, seconds) {
    let state = 'unknown';
    for (let waited = 0; waited <= seconds; waited += 2) {
        state = await panelConnection(page);
        if (wanted.includes(state)) return state;
        await page.sleep(2);
    }
    return state;
}

// Reconnecting takes two steps (2026-10-08): "Install plugin" on the plugin
// page puts the app back in Settings > Plugins but leaves it unconnected,
// then the app's panel needs Connect and the "Add <app> to ChatGPT" Connect.
async function connectApp(page, plugin) {
    await page.goto(`${CHATGPT_URL}/plugins/${plugin}`, { settleMs: 3000 });
    await ensureChatGPTLogin(page);
    let installed = await pluginPageState(page);
    if (installed === 'disconnected') {
        await evaluate(page, `(() => {
            ${CLICK_JS}
            press(Array.from(document.querySelectorAll('main button, main a')).find((b) => b.textContent.trim() === 'Install plugin'));
            return true;
        })()`);
        for (let i = 0; i < 10 && installed !== 'connected'; i++) {
            await page.sleep(2);
            installed = await pluginPageState(page);
        }
    }
    if (installed !== 'connected') throw new CommandExecutionError(`The plugin page for ${plugin} did not show "Try in chat".`);
    await page.goto(settingsUrl(`Plugins/${plugin}`), { settleMs: 3000 });
    const state = await waitForPanel(page, ['connected', 'disconnected'], 10);
    if (state === 'connected') return { Status: 'Already connected', App: '', Plugin: plugin, Tools: (await appPanelTools(page)).length, Changed: '' };
    if (state !== 'disconnected') throw new CommandExecutionError(`The settings panel for ${plugin} shows neither Refresh nor Connect.`);
    for (const step of ['panel', 'confirm']) {
        const pressed = await evaluate(page, `(() => {
            ${CLICK_JS}
            const dialog = Array.from(document.querySelectorAll('[role=dialog]')).pop();
            const button = dialog && Array.from(dialog.querySelectorAll('button'))
                .find((b) => ${step === 'panel' ? '/Connect$/' : '/^Connect$/'}.test(b.textContent.replace(/\\s+/g, ' ').trim()));
            if (!button) return false;
            press(button);
            return true;
        })()`);
        if (!pressed) throw new CommandExecutionError(`No Connect button at the ${step} step for ${plugin}.`);
        await page.sleep(3);
    }
    if (await waitForPanel(page, ['connected'], 12) !== 'connected') throw new CommandExecutionError(`${plugin} did not show Refresh after Connect.`);
    return { Status: 'Connected', App: '', Plugin: plugin, Tools: (await appPanelTools(page)).length, Changed: '' };
}

export const appCommand = cli({
    site: 'chatgpt',
    name: 'app',
    access: 'write',
    description: 'Refresh an installed ChatGPT app\'s tool list, or disconnect and reconnect it (to test ChatGPT with and without the app)',
    domain: CHATGPT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'app', positional: true, required: true, help: 'The app\'s name as Settings > Plugins shows it; for connect, the plugin id (plugin_...) or its /plugins/ URL that disconnect printed' },
        { name: 'action', positional: true, required: true, choices: ['refresh', 'disconnect', 'connect'], help: 'refresh re-reads the tool list; disconnect removes the app from chats; connect installs it again' },
    ],
    columns: ['Status', 'App', 'Plugin', 'Tools', 'Changed'],
    func: async (page, kwargs) => {
        const app = String(kwargs.app || '').trim();
        const action = String(kwargs.action);
        if (action === 'connect') {
            const plugin = parsePluginId(app);
            if (!plugin) throw new ArgumentError('connect takes the plugin id (plugin_...) or its URL', 'Run `opencli chatgpt app "<name>" disconnect` first; it prints the id.');
            return [await connectApp(page, plugin)];
        }
        if (!app) throw new ArgumentError('An app name is required');
        if (action === 'refresh') return [await refreshApp(page, app)];
        return [await disconnectApp(page, app)];
    },
});
