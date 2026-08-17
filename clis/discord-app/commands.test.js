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
    buildReadMessagesScript,
    buildListChannelsScript,
    buildListServersScript,
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

    it('lists servers from current guild navigation items without channel links', () => {
        const rows = runDomScript(`
          <nav>
            <div class="listItem_home" data-list-item-id="guildsnav___home" aria-label="Direct Messages"></div>
            <div class="listItem_server">
              <svg>
                <foreignObject>
                  <div data-dnd-name="OpenCLI">
                    <div data-list-item-id="guildsnav___111" role="treeitem">
                      <span>OpenCLI</span>
                    </div>
                  </div>
                </foreignObject>
              </svg>
            </div>
            <div class="listItem_server">
              <div data-list-item-id="guildsnav___222" role="treeitem" aria-label="Agent Lab"></div>
            </div>
            <div class="listItem_add" data-list-item-id="guildsnav___create-join-a-guild" aria-label="Add a Server"></div>
            <div class="listItem_discover" data-list-item-id="guildsnav___guild-discovery" aria-label="Discover"></div>
          </nav>
        `, buildListServersScript());

        expect(rows).toEqual([
            {
                Index: 1,
                Server: 'OpenCLI',
                guild_id: '111',
                url: 'https://discord.com/channels/111',
            },
            {
                Index: 2,
                Server: 'Agent Lab',
                guild_id: '222',
                url: 'https://discord.com/channels/222',
            },
        ]);
    });

    it('reads embed-only messages when the normal content node is empty', () => {
        const rows = runDomScript(`
          <ol>
            <li id="chat-messages-222-333">
              <h3><span>Ada</span></h3>
              <time datetime="2026-08-17T10:00:00.000Z"></time>
              <div id="message-content-333"></div>
              <article class="embedWrapper_abc">
                <div class="embedTitle_abc">Build finished</div>
                <div class="embedDescription_abc">All checks passed</div>
              </article>
            </li>
          </ol>
        `, buildReadMessagesScript(5));

        expect(rows).toEqual([{
            Author: 'Ada',
            Time: '2026-08-17T10:00:00.000Z',
            Message: 'Build finished All checks passed',
            channel_id: '222',
            message_id: '333',
        }]);
    });

    it('rejects non-numeric guild navigation sentinels and channel/thread-shaped ids', () => {
        const rows = runDomScript(`
          <nav>
            <div data-list-item-id="guildsnav___home" aria-label="Direct Messages"></div>
            <div data-list-item-id="guildsnav___create-join-a-guild" aria-label="Add a Server"></div>
            <div data-list-item-id="guildsnav___guild-discovery" aria-label="Discover"></div>
            <div data-list-item-id="guildsnav___folder-111" aria-label="Folder"></div>
            <div data-list-item-id="guildsnav___333/444" aria-label="Channel Item"></div>
            <div data-list-item-id="guildsnav___555/666/777" aria-label="Thread Item"></div>
            <div data-list-item-id="guildsnav___222" aria-label="Valid Guild"></div>
          </nav>
        `, buildListServersScript());

        expect(rows).toEqual([{
            Index: 1,
            Server: 'Valid Guild',
            guild_id: '222',
            url: 'https://discord.com/channels/222',
        }]);
    });

    it('does not pair a guild id with a broad ancestor or neighboring guild name', () => {
        const rows = runDomScript(`
          <nav>
            <div data-dnd-name="Shared Wrong Wrapper">
              <div data-list-item-id="guildsnav___111" role="treeitem" aria-label="Alpha Guild"></div>
              <div data-list-item-id="guildsnav___222" role="treeitem">
                <img alt="Beta Guild">
              </div>
              <div data-list-item-id="guildsnav___333" role="treeitem"></div>
            </div>
          </nav>
        `, buildListServersScript());

        expect(rows).toEqual([
            {
                Index: 1,
                Server: 'Alpha Guild',
                guild_id: '111',
                url: 'https://discord.com/channels/111',
            },
            {
                Index: 2,
                Server: 'Beta Guild',
                guild_id: '222',
                url: 'https://discord.com/channels/222',
            },
        ]);
    });

    it('uses a narrow owned wrapper name only when it owns exactly one guild item', () => {
        const rows = runDomScript(`
          <nav>
            <div data-dnd-name="Owned Guild">
              <svg>
                <foreignObject>
                  <div data-list-item-id="guildsnav___111" role="treeitem"></div>
                </foreignObject>
              </svg>
            </div>
            <div data-dnd-name="Crowded Wrapper">
              <div data-list-item-id="guildsnav___222" role="treeitem"></div>
              <div data-list-item-id="guildsnav___333" role="treeitem" aria-label="Explicit Neighbor"></div>
            </div>
          </nav>
        `, buildListServersScript());

        expect(rows).toEqual([
            {
                Index: 1,
                Server: 'Owned Guild',
                guild_id: '111',
                url: 'https://discord.com/channels/111',
            },
            {
                Index: 2,
                Server: 'Explicit Neighbor',
                guild_id: '333',
                url: 'https://discord.com/channels/333',
            },
        ]);
    });

    it('keeps supporting legacy guild channel links', () => {
        const rows = runDomScript(`
          <nav>
            <div class="listItem_server">
              <a href="/channels/333" aria-label="Legacy Guild"></a>
            </div>
          </nav>
        `, buildListServersScript());

        expect(rows).toEqual([{
            Index: 1,
            Server: 'Legacy Guild',
            guild_id: '333',
            url: 'https://discord.com/channels/333',
        }]);
    });

    it('keeps legacy guild link fallback strict to Discord guild roots', () => {
        const rows = runDomScript(`
          <nav>
            <a href="https://example.com/channels/111" aria-label="Off Domain"></a>
            <a href="https://discord.com/channels/@me" aria-label="Direct Messages"></a>
            <a href="https://discord.com/channels/222/333" aria-label="Channel Link"></a>
            <a href="https://discord.com/channels/444/555/666" aria-label="Thread Link"></a>
            <a href="https://canary.discord.com/channels/777" title="Canary Guild"></a>
          </nav>
        `, buildListServersScript());

        expect(rows).toEqual([{
            Index: 1,
            Server: 'Canary Guild',
            guild_id: '777',
            url: 'https://discord.com/channels/777',
        }]);
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
    it('unwraps Browser Bridge envelopes for server rows', async () => {
        const page = {
            evaluate: vi.fn().mockResolvedValue({
                session: 'site:discord-app',
                data: [{ Server: 'OpenCLI', guild_id: '111', url: 'https://discord.com/channels/111' }],
            }),
        };

        await expect(listDiscordServers(page)).resolves.toEqual([
            { Server: 'OpenCLI', guild_id: '111', url: 'https://discord.com/channels/111' },
        ]);
    });

    it('returns a valid empty helper result but servers command maps it to EmptyResultError', async () => {
        const page = {
            evaluate: vi.fn().mockResolvedValue({ session: 'site:discord-app', data: [] }),
        };
        const cmd = getRegistry().get('discord-app/servers');

        await expect(listDiscordServers(page)).resolves.toEqual([]);
        await expect(cmd.func(page, {})).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('typed-fails malformed server browser output', async () => {
        const page = {
            evaluate: vi.fn().mockResolvedValue({ session: 'site:discord-app', data: { rows: [] } }),
        };

        await expect(listDiscordServers(page)).rejects.toThrow(CommandExecutionError);
    });

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
