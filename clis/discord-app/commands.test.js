import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './channels.js';
import './goto.js';
import './read.js';
import './search.js';
import './servers.js';
import './thread-read.js';
import './threads.js';
import {
    buildDiscordChannelUrl,
    buildListChannelsScript,
    buildListThreadsScript,
    listDiscordChannels,
    listDiscordServers,
    listDiscordThreads,
    parseDiscordChannelUrl,
    resolveDiscordChannelTarget,
} from './utils.js';

function runDomScript(html, script, url = 'https://discord.com/channels/111/222') {
    const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
    return dom.window.eval(script);
}

function createRoutePage({ route, rows = [] }) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn(async (script) => {
            if (script.includes('__opencliDiscordRouteState')) {
                return {
                    url: route.url,
                    route: {
                        guild_id: route.guild_id,
                        channel_id: route.channel_id,
                        thread_id: route.thread_id || '',
                    },
                    has_messages: true,
                    has_threads: false,
                    has_header: true,
                };
            }
            if (script.includes('__opencliDiscordReadMessages')) return rows;
            throw new Error(`unexpected evaluate script: ${script.slice(0, 80)}`);
        }),
    };
}

describe('discord-app url helpers', () => {
    it('parses and builds channel and thread URLs', () => {
        expect(parseDiscordChannelUrl('https://discord.com/channels/111/222')).toEqual({
            guild_id: '111',
            channel_id: '222',
            url: 'https://discord.com/channels/111/222',
        });
        expect(parseDiscordChannelUrl('/channels/111/222/333')).toEqual({
            guild_id: '111',
            channel_id: '222',
            thread_id: '333',
            url: 'https://discord.com/channels/111/222/333',
        });
        expect(buildDiscordChannelUrl({ guildId: '111', channelId: '222', threadId: '333' }))
            .toBe('https://discord.com/channels/111/222/333');
    });

    it('rejects non-Discord URLs', () => {
        expect(parseDiscordChannelUrl('https://example.com/channels/111/222')).toBeNull();
        expect(parseDiscordChannelUrl('javascript:alert(1)')).toBeNull();
    });
});

describe('discord-app DOM extraction scripts', () => {
    it('lists channel metadata from stable Discord channel links', () => {
        const rows = runDomScript(`
          <nav>
            <a data-list-item-id="channels___222" href="/channels/111/222" aria-label="unread, general (text channel)">general</a>
            <a data-list-item-id="channels___333" href="/channels/111/333" aria-label="support（forum channel）">support</a>
            <a data-list-item-id="channels___444" href="/channels/111/444" aria-label="Ops (Voice channel)">Ops</a>
            <a data-list-item-id="channels___cat" href="/channels/111/555" aria-label="Info (category)">Info</a>
          </nav>
        `, buildListChannelsScript());

        expect(rows).toEqual([
            {
                Index: 1,
                Channel: 'general',
                Type: 'Text',
                guild_id: '111',
                channel_id: '222',
                url: 'https://discord.com/channels/111/222',
            },
            {
                Index: 2,
                Channel: 'support',
                Type: 'Forum',
                guild_id: '111',
                channel_id: '333',
                url: 'https://discord.com/channels/111/333',
            },
            {
                Index: 3,
                Channel: 'Ops',
                Type: 'Voice',
                guild_id: '111',
                channel_id: '444',
                url: 'https://discord.com/channels/111/444',
            },
        ]);
    });

    it('lists visible forum/thread cards with thread ids', () => {
        const rows = runDomScript(`
          <main>
            <article class="mainCard_abc">
              <a href="/channels/111/333/555" aria-label="Release planning"></a>
              <h3 class="title_abc">Release planning</h3>
              <span class="username_abc">Alex</span>
              <time datetime="2026-06-15T01:02:03.000Z">today</time>
              <p>Discuss launch blockers</p>
            </article>
          </main>
        `, buildListThreadsScript(10));

        expect(rows).toEqual([expect.objectContaining({
            Index: 1,
            Thread: 'Release planning',
            Author: 'Alex',
            Updated: '2026-06-15T01:02:03.000Z',
            guild_id: '111',
            channel_id: '333',
            thread_id: '555',
            url: 'https://discord.com/channels/111/333/555',
        })]);
    });
});

describe('discord-app command registration', () => {
    it('registers read-only navigation and thread commands', () => {
        for (const name of ['channels', 'goto', 'read', 'servers', 'threads', 'thread-read']) {
            const cmd = getRegistry().get(`discord-app/${name}`);
            expect(cmd, `discord-app/${name}`).toBeDefined();
            expect(cmd.access).toBe('read');
            expect(cmd.browser).toBe(true);
            expect(cmd.domain).toBe('localhost');
        }
    });
});

describe('discord-app search', () => {
    function createSearchPage(bodyText = '', resultRows = []) {
        return {
            pressKey: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn(async (script) => {
                if (script.includes('const input = document.querySelector')) return undefined;
                if (script.includes('const items = []')) {
                    const rowsHtml = resultRows.map((row, index) => `
                      <div class="searchResult_${index}" id="search-result-${index}">
                        <span class="username">${row.author}</span>
                        <div id="message-content-${index}">${row.message}</div>
                      </div>
                    `).join('');
                    const dom = new JSDOM(`<!doctype html><body>${bodyText}${rowsHtml}</body>`, {
                        url: 'https://discord.com/channels/111/222',
                        runScripts: 'outside-only',
                    });
                    return dom.window.eval(script);
                }
                throw new Error(`unexpected evaluate script: ${script.slice(0, 80)}`);
            }),
        };
    }

    it('throws EmptyResultError when Discord shows an explicit no-results state', async () => {
        const cmd = getRegistry().get('discord-app/search');
        const page = createSearchPage('<div>No results found</div>');

        await expect(cmd.func(page, { query: 'missing' })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('throws CommandExecutionError when result selectors return no rows and no empty-state marker', async () => {
        const cmd = getRegistry().get('discord-app/search');
        const page = createSearchPage('<main>search panel changed</main>');

        await expect(cmd.func(page, { query: 'missing' })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});

describe('discord-app list row validation', () => {
    it('typed-fails channel rows missing stable channel identity', async () => {
        const page = {
            evaluate: vi.fn().mockResolvedValue([{ Channel: 'general', guild_id: '111', url: 'https://discord.com/channels/111/222' }]),
        };

        await expect(listDiscordChannels(page)).rejects.toThrow(CommandExecutionError);
    });

    it('typed-fails server rows missing stable guild identity', async () => {
        const page = {
            evaluate: vi.fn().mockResolvedValue([{ Server: 'OpenCLI', url: 'https://discord.com/channels/111' }]),
        };

        await expect(listDiscordServers(page)).rejects.toThrow(CommandExecutionError);
    });

    it('typed-fails thread rows missing stable thread identity', async () => {
        const page = {
            evaluate: vi.fn().mockResolvedValue([{ Thread: 'release', guild_id: '111', channel_id: '333', url: 'https://discord.com/channels/111/333/555' }]),
        };

        await expect(listDiscordThreads(page, 10)).rejects.toThrow(CommandExecutionError);
    });
});

describe('discord-app targeted reads', () => {
    it('read --url navigates once before scraping messages', async () => {
        const cmd = getRegistry().get('discord-app/read');
        const page = createRoutePage({
            route: { guild_id: '111', channel_id: '222', url: 'https://discord.com/channels/111/222' },
            rows: [{ Author: 'Ada', Time: '2026-06-15T00:00:00.000Z', Message: 'hello', channel_id: '222', message_id: '999' }],
        });

        await expect(cmd.func(page, { url: 'https://discord.com/channels/111/222', count: '1' }))
            .resolves.toEqual([{ Author: 'Ada', Time: '2026-06-15T00:00:00.000Z', Message: 'hello', channel_id: '222', message_id: '999' }]);

        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.goto).toHaveBeenCalledWith('https://discord.com/channels/111/222', { waitUntil: 'none', settleMs: 1000 });
    });

    it('read --url rejects stale messages from another channel after navigation', async () => {
        const cmd = getRegistry().get('discord-app/read');
        const page = createRoutePage({
            route: { guild_id: '111', channel_id: '222', url: 'https://discord.com/channels/111/222' },
            rows: [{ Author: 'Ada', Time: '', Message: 'stale', channel_id: '999', message_id: '123' }],
        });

        await expect(cmd.func(page, { url: 'https://discord.com/channels/111/222', count: '1' }))
            .rejects.toThrow(CommandExecutionError);
    });

    it('read --url rejects message rows without channel_id proof after navigation', async () => {
        const cmd = getRegistry().get('discord-app/read');
        const page = createRoutePage({
            route: { guild_id: '111', channel_id: '222', url: 'https://discord.com/channels/111/222' },
            rows: [{ Author: 'Ada', Time: '', Message: 'unbound', message_id: '123' }],
        });

        await expect(cmd.func(page, { url: 'https://discord.com/channels/111/222', count: '1' }))
            .rejects.toThrow(CommandExecutionError);
    });

    it('read --url throws EmptyResultError instead of a success-shaped empty row', async () => {
        const cmd = getRegistry().get('discord-app/read');
        const page = createRoutePage({
            route: { guild_id: '111', channel_id: '222', url: 'https://discord.com/channels/111/222' },
            rows: [],
        });

        await expect(cmd.func(page, { url: 'https://discord.com/channels/111/222', count: '1' }))
            .rejects.toThrow(EmptyResultError);
    });

    it('read fails typed when browser extraction returns malformed message rows', async () => {
        const cmd = getRegistry().get('discord-app/read');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn(async (script) => {
                if (script.includes('__opencliDiscordRouteState')) {
                    return { url: 'https://discord.com/channels/111/222', route: { guild_id: '111', channel_id: '222', thread_id: '' }, has_messages: true };
                }
                if (script.includes('__opencliDiscordReadMessages')) return { rows: [] };
                throw new Error(`unexpected evaluate script: ${script.slice(0, 80)}`);
            }),
        };

        await expect(cmd.func(page, { url: 'https://discord.com/channels/111/222', count: '1' }))
            .rejects.toThrow(CommandExecutionError);
    });

    it('read unwraps Browser Bridge evaluate envelopes before shape validation', async () => {
        const cmd = getRegistry().get('discord-app/read');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn(async (script) => {
                if (script.includes('__opencliDiscordRouteState')) {
                    return {
                        session: 'site:discord-app',
                        data: { url: 'https://discord.com/channels/111/222', route: { guild_id: '111', channel_id: '222', thread_id: '' }, has_messages: true },
                    };
                }
                if (script.includes('__opencliDiscordReadMessages')) {
                    return {
                        session: 'site:discord-app',
                        data: [{ Author: 'Ada', Time: '', Message: 'wrapped', channel_id: '222', message_id: '999' }],
                    };
                }
                throw new Error(`unexpected evaluate script: ${script.slice(0, 80)}`);
            }),
        };

        await expect(cmd.func(page, { url: 'https://discord.com/channels/111/222', count: '1' }))
            .resolves.toEqual([{ Author: 'Ada', Time: '', Message: 'wrapped', channel_id: '222', message_id: '999' }]);
    });

    it('read --url waits for the message list after route navigation', async () => {
        const cmd = getRegistry().get('discord-app/read');
        let routeStateCalls = 0;
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn(async (script) => {
                if (script.includes('__opencliDiscordRouteState')) {
                    routeStateCalls += 1;
                    return {
                        url: 'https://discord.com/channels/111/222',
                        route: { guild_id: '111', channel_id: '222', thread_id: '' },
                        has_messages: routeStateCalls >= 3,
                        has_threads: false,
                        has_header: true,
                    };
                }
                if (script.includes('__opencliDiscordReadMessages')) {
                    return [{ Author: 'Ada', Time: '', Message: 'hydrated', channel_id: '222', message_id: '999' }];
                }
                throw new Error(`unexpected evaluate script: ${script.slice(0, 80)}`);
            }),
        };

        await expect(cmd.func(page, { url: 'https://discord.com/channels/111/222', count: '1' }))
            .resolves.toEqual([{ Author: 'Ada', Time: '', Message: 'hydrated', channel_id: '222', message_id: '999' }]);

        expect(page.wait).toHaveBeenCalledWith(0.5);
        expect(routeStateCalls).toBeGreaterThanOrEqual(2);
    });

    it('goto builds numeric guild/channel routes without reading channel DOM', async () => {
        const cmd = getRegistry().get('discord-app/goto');
        const page = createRoutePage({
            route: { guild_id: '111', channel_id: '222', url: 'https://discord.com/channels/111/222' },
        });

        await expect(cmd.func(page, { guild: '111', channel: '222' })).resolves.toEqual([{
            Status: 'Opened',
            guild_id: '111',
            channel_id: '222',
            url: 'https://discord.com/channels/111/222',
        }]);
        expect(page.goto).toHaveBeenCalledWith('https://discord.com/channels/111/222', { waitUntil: 'none', settleMs: 1000 });
    });

    it('resolves visible channel names from the current sidebar', async () => {
        const page = {
            evaluate: vi.fn(async (script) => {
                if (script.includes('__opencliDiscordListChannels')) {
                    return [{ Channel: 'general', guild_id: '111', channel_id: '222', url: 'https://discord.com/channels/111/222' }];
                }
                throw new Error(`unexpected evaluate script: ${script.slice(0, 80)}`);
            }),
        };

        await expect(resolveDiscordChannelTarget(page, { channel: 'general' }, { required: true })).resolves.toEqual({
            guild_id: '111',
            channel_id: '222',
            url: 'https://discord.com/channels/111/222',
        });
    });

    it('thread-read navigates to a thread URL and then reads messages', async () => {
        const cmd = getRegistry().get('discord-app/thread-read');
        const page = createRoutePage({
            route: { guild_id: '111', channel_id: '333', thread_id: '555', url: 'https://discord.com/channels/111/333/555' },
            rows: [{ Author: 'Grace', Time: '', Message: 'thread message', channel_id: '555', message_id: '777' }],
        });

        await expect(cmd.func(page, { url: 'https://discord.com/channels/111/333/555', count: '1' }))
            .resolves.toEqual([{ Author: 'Grace', Time: '', Message: 'thread message', channel_id: '555', message_id: '777' }]);
        expect(page.goto).toHaveBeenCalledWith('https://discord.com/channels/111/333/555', { waitUntil: 'none', settleMs: 1000 });
    });

    it('thread-read rejects messages from the parent channel instead of the requested thread', async () => {
        const cmd = getRegistry().get('discord-app/thread-read');
        const page = createRoutePage({
            route: { guild_id: '111', channel_id: '333', thread_id: '555', url: 'https://discord.com/channels/111/333/555' },
            rows: [{ Author: 'Grace', Time: '', Message: 'parent message', channel_id: '333', message_id: '777' }],
        });

        await expect(cmd.func(page, { url: 'https://discord.com/channels/111/333/555', count: '1' }))
            .rejects.toThrow(CommandExecutionError);
    });
});
